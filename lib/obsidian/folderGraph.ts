/**
 * 資料夾與圖譜的「選用」關聯功能。
 * - 預設完全關閉，只有使用者選取的資料夾才產生關聯。
 * - 連線依筆記的 folder 欄位動態計算，絕不更動筆記內文或 outlinks。
 * - 僅連結直接屬於該資料夾的筆記；子資料夾分開設定。
 */

import { buildGraphData } from "./links";
import type { GraphData, GraphLink, GraphNode, Note, NoteMetadata } from "./types";

const STORAGE_KEY = "obsidian-folder-graph-links-v1";
export const FOLDER_GRAPH_CHANGED_EVENT = "obsidian-folder-graph-links-changed";

export type GraphNote = Note | NoteMetadata;

export function normalizeGraphFolderPath(value: string): string {
  return value.split("/").map((part) => part.trim()).filter(Boolean).join("/");
}

export function getGraphFolderNodeId(folder: string): string {
  return `graph-folder:${encodeURIComponent(normalizeGraphFolderPath(folder))}`;
}

/** 讀取已開啟的資料夾清單。舊使用者或未操作時為空陣列。 */
export function getGraphLinkedFolders(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return Array.from(new Set(saved.filter((v): v is string => typeof v === "string")
      .map(normalizeGraphFolderPath).filter(Boolean)));
  } catch {
    return [];
  }
}

function saveGraphLinkedFolders(paths: string[]): string[] {
  const next = Array.from(new Set(paths.map(normalizeGraphFolderPath).filter(Boolean)));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FOLDER_GRAPH_CHANGED_EVENT));
  }
  return next;
}

/** 每個資料夾由使用者分別開啟／關閉，不會自動套用到其他資料夾。 */
export function setGraphFolderLinked(path: string, enabled: boolean): string[] {
  const folder = normalizeGraphFolderPath(path);
  const paths = getGraphLinkedFolders();
  if (!folder) return paths;
  return saveGraphLinkedFolders(enabled
    ? [...paths, folder]
    : paths.filter((item) => item !== folder));
}

/** 資料夾重新命名／拖曳時，同步搬移自身及子資料夾的圖譜設定。 */
export function moveGraphFolderLinkSettings(fromPath: string, toPath: string): void {
  const from = normalizeGraphFolderPath(fromPath);
  const to = normalizeGraphFolderPath(toPath);
  if (!from || !to || from === to) return;
  const current = getGraphLinkedFolders();
  if (!current.some((p) => p === from || p.startsWith(from + "/"))) return;
  saveGraphLinkedFolders(current.map((p) => {
    if (p === from) return to;
    if (p.startsWith(from + "/")) return to + p.slice(from.length);
    return p;
  }));
}

/** 刪除資料夾時清掉該路徑及其子資料夾的連線設定。 */
export function removeGraphFolderLinkSettings(path: string): void {
  const folder = normalizeGraphFolderPath(path);
  if (!folder) return;
  const current = getGraphLinkedFolders();
  const next = current.filter((p) => p !== folder && !p.startsWith(folder + "/"));
  if (next.length !== current.length) saveGraphLinkedFolders(next);
}

/** 整理實際存在的資料夾，包括巢狀資料夾的父層與手動建立的空資料夾。 */
export function collectGraphFolderPaths(notes: GraphNote[], customFolders: string[] = []): string[] {
  const paths = new Set<string>();
  for (const folder of [...customFolders, ...notes.map((note) => note.folder || "")]) {
    const normalized = normalizeGraphFolderPath(folder);
    if (!normalized) continue;
    const parts = normalized.split("/");
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join("/"));
  }
  return Array.from(paths).sort((a, b) => a.localeCompare(b, "zh-Hant", { numeric: true }));
}

/** 將啟用的資料夾加入現有 GraphData。筆記原本的 Wikilink 連線完整保留。 */
export function addFolderLinksToGraph(
  graph: GraphData,
  notes: GraphNote[],
  linkedPaths: string[],
  availablePaths: string[],
  centeredFolder?: string
): GraphData {
  const available = new Set(availablePaths.map(normalizeGraphFolderPath));
  const enabled = Array.from(new Set(linkedPaths.map(normalizeGraphFolderPath)))
    .filter((path) => available.has(path));
  if (!enabled.length) return graph;

  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = [...graph.links];
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const seenLinks = new Set(links.map((link) => [link.source, link.target].sort().join("|")));

  for (const path of enabled) {
    const members = notes.filter((note) => normalizeGraphFolderPath(note.folder || "") === path
      && visibleNodeIds.has(note.id));
    const folderId = getGraphFolderNodeId(path);
    if (visibleNodeIds.has(folderId)) continue;

    // 讓全域圖譜的資料夾出現在自身筆記群附近；局部圖譜則置於中心。
    const memberNodes = members.map((note) => nodes.find((node) => node.id === note.id))
      .filter((node): node is GraphNode => Boolean(node));
    const x = centeredFolder === path ? 0 : memberNodes.length
      ? memberNodes.reduce((sum, node) => sum + node.x, 0) / memberNodes.length
      : -110;
    const y = centeredFolder === path ? 0 : memberNodes.length
      ? memberNodes.reduce((sum, node) => sum + node.y, 0) / memberNodes.length - 45
      : -110;

    nodes.push({
      id: folderId,
      label: `📁 ${path.split("/").pop() || path}`,
      type: "folder",
      folderPath: path,
      x, y, vx: 0, vy: 0,
      radius: Math.min(23, Math.max(12, 11 + members.length * 0.55)),
      connectionsCount: members.length,
    });
    visibleNodeIds.add(folderId);

    for (const note of members) {
      const linkKey = [folderId, note.id].sort().join("|");
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);
      const link: GraphLink = { source: folderId, target: note.id, kind: "folder" };
      links.push(link);
      const node = nodes.find((item) => item.id === note.id);
      if (node) node.connectionsCount += 1;
    }
  }
  return { nodes, links };
}

/** 點擊資料夾節點後的局部圖譜：該資料夾與所有可顯示的直屬筆記。 */
export function buildFolderLocalGraph(
  folderPath: string,
  allNotes: GraphNote[],
  maxNodes: number = 300
): GraphData & { isCapped: boolean } {
  const path = normalizeGraphFolderPath(folderPath);
  const members = allNotes.filter((note) => normalizeGraphFolderPath(note.folder || "") === path);
  const cappedNotes = members.slice(0, maxNodes);
  const base = buildGraphData(cappedNotes, maxNodes);
  const visible = new Set(cappedNotes.map((note) => note.id));
  // 局部資料夾圖只顯示其內容，不額外顯示與外部筆記的未解決連結。
  const trimmed: GraphData = {
    nodes: base.nodes.filter((node) => visible.has(node.id)),
    links: base.links.filter((link) => visible.has(link.source) && visible.has(link.target)),
  };
  const graph = addFolderLinksToGraph(trimmed, cappedNotes, [path], [path], path);
  return { ...graph, isCapped: members.length > maxNodes };
}
