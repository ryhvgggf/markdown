import { BacklinkItem, GraphData, GraphLink, GraphNode, Note, NoteMetadata } from "./types";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 計算指定筆記的反向連結（被哪些其他筆記引用）
 */
export function getBacklinks(
  targetNote: { id: string; title: string },
  allNotes: Array<Note | NoteMetadata>
): BacklinkItem[] {
  if (!targetNote || !targetNote.title) return [];

  const targetTitleLower = targetNote.title.trim().toLowerCase();
  const backlinks: BacklinkItem[] = [];

  for (const note of allNotes) {
    if (note.id === targetNote.id) continue;

    const hasOutlink = note.outlinks.some(
      (link) => link.trim().toLowerCase() === targetTitleLower
    );

    if (hasOutlink) {
      let snippet = "引用了此筆記";
      if ("content" in note && typeof (note as Note).content === "string") {
        const fullContent = (note as Note).content;
        const safeTitle = escapeRegex(targetNote.title);
        const regex = new RegExp("\\[\\[" + safeTitle + "(?:\\|[^\\]]+)?\\]\\]", "i");
        const match = regex.exec(fullContent);
        if (match) {
          const start = Math.max(0, match.index - 40);
          const end = Math.min(fullContent.length, match.index + match[0].length + 40);
          const prefix = start > 0 ? "..." : "";
          const suffix = end < fullContent.length ? "..." : "";
          snippet = prefix + fullContent.substring(start, end).replace(/\n/g, " ") + suffix;
        }
      }

      backlinks.push({
        sourceNoteId: note.id,
        sourceNoteTitle: note.title,
        contextSnippet: snippet,
      });
    }
  }

  return backlinks;
}

/**
 * 統計 Vault 中所有標籤及其出現頻率
 */
export function getAllTagsWithCounts(
  notes: Array<Note | NoteMetadata>
): { tag: string; count: number }[] {
  const countMap = new Map<string, number>();

  for (const note of notes) {
    for (const tag of note.tags) {
      const cleanTag = tag.trim();
      if (!cleanTag) continue;
      countMap.set(cleanTag, (countMap.get(cleanTag) ?? 0) + 1);
    }
  }

  return Array.from(countMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * 建構關聯圖譜節點與連線資料（Graph View）
 * 支援 maxNodes 閥值限制（防止超大型知識庫造成瀏覽器卡頓）
 */
export function buildGraphData(
  notes: Array<Note | NoteMetadata>,
  maxNodes: number = 300
): GraphData & { isCapped: boolean; totalNoteCount: number } {
  const totalNoteCount = notes.length;
  const limitedNotes = notes.length > maxNodes ? notes.slice(0, maxNodes) : notes;
  const isCapped = notes.length > maxNodes;

  const noteMapByTitle = new Map<string, Note | NoteMetadata>();
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const connectionCounts = new Map<string, number>();

  limitedNotes.forEach((note) => {
    noteMapByTitle.set(note.title.trim().toLowerCase(), note);
  });

  // 1. 初始化既有筆記節點
  limitedNotes.forEach((note, index) => {
    const angle = (index / Math.max(1, limitedNotes.length)) * 2 * Math.PI;
    const distance = 140 + Math.random() * 80;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    nodesMap.set(note.id, {
      id: note.id,
      label: note.title,
      type: "note",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 6,
      connectionsCount: 0,
    });
  });

  // 2. 建立連線並計數關聯數
  const seenLinks = new Set<string>();

  limitedNotes.forEach((sourceNote) => {
    sourceNote.outlinks.forEach((targetTitle) => {
      const targetTitleLower = targetTitle.trim().toLowerCase();
      const targetNote = noteMapByTitle.get(targetTitleLower);

      let targetNodeId: string;
      if (targetNote) {
        targetNodeId = targetNote.id;
      } else {
        targetNodeId = "unresolved-" + targetTitleLower;
        if (!nodesMap.has(targetNodeId)) {
          const angle = Math.random() * 2 * Math.PI;
          const distance = 240;
          nodesMap.set(targetNodeId, {
            id: targetNodeId,
            label: targetTitle,
            type: "unresolved",
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance,
            vx: 0,
            vy: 0,
            radius: 4,
            connectionsCount: 0,
          });
        }
      }

      if (sourceNote.id !== targetNodeId) {
        const linkKey = [sourceNote.id, targetNodeId].sort().join("<->");
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey);
          links.push({
            source: sourceNote.id,
            target: targetNodeId,
          });
          connectionCounts.set(sourceNote.id, (connectionCounts.get(sourceNote.id) ?? 0) + 1);
          connectionCounts.set(targetNodeId, (connectionCounts.get(targetNodeId) ?? 0) + 1);
        }
      }
    });
  });

  // 3. 依關聯數更新節點半徑
  const nodes = Array.from(nodesMap.values()).map((node) => {
    const connections = connectionCounts.get(node.id) ?? 0;
    return {
      ...node,
      connectionsCount: connections,
      radius: Math.min(20, Math.max(5, 5 + connections * 2)),
    };
  });

  return { nodes, links, isCapped, totalNoteCount };
}

/**
 * 局部圖譜 (Local Graph)：僅載入當前選中筆記及其 1 度直接關聯之鄰居節點
 */
export function buildLocalGraphData(
  activeNoteId: string,
  notes: Array<Note | NoteMetadata>
): GraphData {
  const currentNote = notes.find((n) => n.id === activeNoteId);
  if (!currentNote) {
    return { nodes: [], links: [] };
  }

  const currentTitleLower = currentNote.title.trim().toLowerCase();
  const relatedNoteIds = new Set<string>([activeNoteId]);
  const titleToNoteMap = new Map<string, Note | NoteMetadata>();

  notes.forEach((n) => {
    titleToNoteMap.set(n.title.trim().toLowerCase(), n);
  });

  // 1. 找出當前筆記連出去的筆記 (Outlinks)
  currentNote.outlinks.forEach((targetTitle) => {
    const target = titleToNoteMap.get(targetTitle.trim().toLowerCase());
    if (target) {
      relatedNoteIds.add(target.id);
    }
  });

  // 2. 找出連進當前筆記的反向筆記 (Backlinks)
  notes.forEach((n) => {
    if (n.outlinks.some((link) => link.trim().toLowerCase() === currentTitleLower)) {
      relatedNoteIds.add(n.id);
    }
  });

  // 篩選出相關節點
  const localNotes = notes.filter((n) => relatedNoteIds.has(n.id));

  // 建構局部圖譜節點
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const seenLinks = new Set<string>();
  const connectionCounts = new Map<string, number>();

  nodesMap.set(currentNote.id, {
    id: currentNote.id,
    label: currentNote.title,
    type: "note",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 12,
    connectionsCount: 0,
  });

  const neighbors = localNotes.filter((n) => n.id !== activeNoteId);
  neighbors.forEach((n, idx) => {
    const angle = (idx / Math.max(1, neighbors.length)) * 2 * Math.PI;
    const distance = 140;
    nodesMap.set(n.id, {
      id: n.id,
      label: n.title,
      type: "note",
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      radius: 7,
      connectionsCount: 0,
    });
  });

  localNotes.forEach((source) => {
    source.outlinks.forEach((targetTitle) => {
      const target = titleToNoteMap.get(targetTitle.trim().toLowerCase());
      if (target && nodesMap.has(target.id)) {
        const linkKey = [source.id, target.id].sort().join("<->");
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey);
          links.push({ source: source.id, target: target.id });
          connectionCounts.set(source.id, (connectionCounts.get(source.id) ?? 0) + 1);
          connectionCounts.set(target.id, (connectionCounts.get(target.id) ?? 0) + 1);
        }
      }
    });
  });

  const nodes = Array.from(nodesMap.values()).map((node) => ({
    ...node,
    connectionsCount: connectionCounts.get(node.id) ?? 0,
    radius: node.id === activeNoteId ? 14 : Math.min(18, Math.max(6, 6 + (connectionCounts.get(node.id) ?? 0) * 2)),
  }));

  return { nodes, links };
}
