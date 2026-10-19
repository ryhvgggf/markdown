/**
 * 圖譜資料夾關聯 v2：所有關聯均為選用，不修改筆記內文或實際資料夾歸屬。
 * - 每個資料夾可以獨立決定是否在圖譜顯示。
 * - 每篇直屬筆記與每個直屬子資料夾，都是個別的連線開關。
 * - 不跨層連線：父資料夾不能直接連孫資料夾的筆記。
 * - 舊版 v1 的「整個資料夾開啟」會遷移成已存在直屬筆記的選擇。
 */
import { buildGraphData } from "./links";
import type { GraphData, GraphLink, GraphNode, Note, NoteMetadata } from "./types";

export type GraphNote = Note | NoteMetadata;
export interface FolderGraphSelections {
  noteIds: string[];
  childFolders: string[];
}
export interface FolderGraphSettings {
  version: 2;
  visibleFolders: string[];
  selections: Record<string, FolderGraphSelections>;
}

const STORAGE_KEY = "obsidian-folder-graph-links-v2";
const LEGACY_STORAGE_KEY = "obsidian-folder-graph-links-v1";
export const FOLDER_GRAPH_CHANGED_EVENT = "obsidian-folder-graph-links-changed";
export const FOLDER_GRAPH_STORAGE_KEYS = [STORAGE_KEY, LEGACY_STORAGE_KEY];

export function normalizeGraphFolderPath(value: string): string {
  return value.split("/").map((part) => part.trim()).filter(Boolean).join("/");
}

export function getGraphFolderNodeId(folder: string): string {
  return `graph-folder:${encodeURIComponent(normalizeGraphFolderPath(folder))}`;
}

export function getGraphFolderParent(path: string): string {
  const folder = normalizeGraphFolderPath(path);
  return folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
}

export function collectGraphFolderPaths(notes: GraphNote[], customFolders: string[] = []): string[] {
  const paths = new Set<string>();
  for (const candidate of [...customFolders, ...notes.map((note) => note.folder || "")]) {
    const folder = normalizeGraphFolderPath(candidate);
    if (!folder) continue;
    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join("/"));
  }
  return [...paths].sort((a, b) => a.localeCompare(b, "zh-Hant", { numeric: true }));
}

export function getDirectGraphChildren(folder: string, paths: string[]): string[] {
  const parent = normalizeGraphFolderPath(folder);
  return paths.filter((path) => getGraphFolderParent(path) === parent && path !== parent);
}

function empty(): FolderGraphSettings {
  return { version: 2, visibleFolders: [], selections: {} };
}

function cleanSettings(raw: FolderGraphSettings): FolderGraphSettings {
  const visible = new Set(raw.visibleFolders.map(normalizeGraphFolderPath).filter(Boolean));
  const selections: Record<string, FolderGraphSelections> = {};
  for (const [key, value] of Object.entries(raw.selections || {})) {
    const path = normalizeGraphFolderPath(key);
    if (!path || !value) continue;
    const noteIds = [...new Set((Array.isArray(value.noteIds) ? value.noteIds : [])
      .filter((id): id is string => typeof id === "string" && Boolean(id)))];
    const childFolders = [...new Set((Array.isArray(value.childFolders) ? value.childFolders : [])
      .filter((child): child is string => typeof child === "string")
      .map(normalizeGraphFolderPath)
      .filter((child) => getGraphFolderParent(child) === path))];
    if (noteIds.length || childFolders.length) selections[path] = { noteIds, childFolders };
  }
  return { version: 2, visibleFolders: [...visible], selections };
}

/**
 * 若舊版曾啟用某資料夾，保留該資料夾及其現有直屬筆記的連線。
 * 遷移後，新增筆記仍預設不連線；子資料夾連線一律預設不啟用。
 */
export function readFolderGraphSettings(notes: GraphNote[] = []): FolderGraphSettings {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<FolderGraphSettings>;
      if (value && value.version === 2 && Array.isArray(value.visibleFolders) && value.selections) {
        return cleanSettings(value as FolderGraphSettings);
      }
    }
  } catch { /* 損毀設定不阻止網站開啟 */ }

  try {
    const old = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    if (!Array.isArray(old) || !old.length) return empty();
    const legacyFolders = [...new Set(old.filter((s): s is string => typeof s === "string")
      .map(normalizeGraphFolderPath).filter(Boolean))];
    const settings = empty();
    settings.visibleFolders = legacyFolders;
    for (const folder of legacyFolders) {
      const noteIds = notes.filter((note) => normalizeGraphFolderPath(note.folder || "") === folder)
        .map((note) => note.id);
      if (noteIds.length) settings.selections[folder] = { noteIds, childFolders: [] };
    }
    // 等到筆記真正載入後才存入新版，避免最初空清單使原有連線遺失。
    if (notes.length) writeFolderGraphSettings(settings);
    return settings;
  } catch {
    return empty();
  }
}

function writeFolderGraphSettings(settings: FolderGraphSettings): FolderGraphSettings {
  const next = cleanSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FOLDER_GRAPH_CHANGED_EVENT));
  }
  return next;
}

export function isGraphFolderVisible(settings: FolderGraphSettings, path: string): boolean {
  return settings.visibleFolders.includes(normalizeGraphFolderPath(path));
}

export function hasGraphNoteLink(settings: FolderGraphSettings, folder: string, noteId: string): boolean {
  return Boolean(settings.selections[normalizeGraphFolderPath(folder)]?.noteIds.includes(noteId));
}

export function hasGraphChildLink(settings: FolderGraphSettings, folder: string, child: string): boolean {
  return Boolean(settings.selections[normalizeGraphFolderPath(folder)]?.childFolders.includes(normalizeGraphFolderPath(child)));
}

export function setGraphFolderVisible(path: string, visible: boolean, notes: GraphNote[] = []): FolderGraphSettings {
  const folder = normalizeGraphFolderPath(path);
  const settings = readFolderGraphSettings(notes);
  if (!folder) return settings;
  const paths = new Set(settings.visibleFolders);
  if (visible) paths.add(folder);
  else paths.delete(folder);
  settings.visibleFolders = [...paths];
  return writeFolderGraphSettings(settings);
}

/** 僅允許選擇此資料夾真正的直屬筆記。 */
export function setGraphFolderNoteLink(folderPath: string, noteId: string, checked: boolean, notes: GraphNote[]): FolderGraphSettings {
  const folder = normalizeGraphFolderPath(folderPath);
  const settings = readFolderGraphSettings(notes);
  if (!folder || !notes.some((note) => note.id === noteId && normalizeGraphFolderPath(note.folder || "") === folder)) return settings;
  const entry = settings.selections[folder] || { noteIds: [], childFolders: [] };
  const ids = new Set(entry.noteIds);
  if (checked) ids.add(noteId);
  else ids.delete(noteId);
  settings.selections[folder] = { ...entry, noteIds: [...ids] };
  if (checked && !settings.visibleFolders.includes(folder)) settings.visibleFolders.push(folder);
  return writeFolderGraphSettings(settings);
}

/** 僅允許選擇真正的直屬子資料夾，不會自動選擇孫筆記。 */
export function setGraphFolderChildLink(folderPath: string, childPath: string, checked: boolean, notes: GraphNote[] = []): FolderGraphSettings {
  const folder = normalizeGraphFolderPath(folderPath);
  const child = normalizeGraphFolderPath(childPath);
  const settings = readFolderGraphSettings(notes);
  if (!folder || !child || getGraphFolderParent(child) !== folder) return settings;
  const entry = settings.selections[folder] || { noteIds: [], childFolders: [] };
  const children = new Set(entry.childFolders);
  if (checked) children.add(child);
  else children.delete(child);
  settings.selections[folder] = { ...entry, childFolders: [...children] };
  if (checked && !settings.visibleFolders.includes(folder)) settings.visibleFolders.push(folder);
  return writeFolderGraphSettings(settings);
}

/** 搬動或重新命名資料夾時，更新所有設定鍵、路徑及父子連線；筆記 ID 不變。 */
export function moveGraphFolderLinkSettings(fromPath: string, toPath: string): void {
  const from = normalizeGraphFolderPath(fromPath);
  const to = normalizeGraphFolderPath(toPath);
  if (!from || !to || from === to) return;
  const settings = readFolderGraphSettings();
  const relocate = (path: string) => path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path;
  settings.visibleFolders = settings.visibleFolders.map(relocate);
  const entries: Record<string, FolderGraphSelections> = {};
  for (const [folder, choice] of Object.entries(settings.selections)) {
    const next = relocate(folder);
    const children = choice.childFolders.map(relocate);
    entries[next] = { noteIds: [...new Set([...(entries[next]?.noteIds || []), ...choice.noteIds])], childFolders: [...new Set([...(entries[next]?.childFolders || []), ...children])] };
  }
  settings.selections = entries;
  writeFolderGraphSettings(settings);
}

export function removeGraphFolderLinkSettings(folderPath: string): void {
  const folder = normalizeGraphFolderPath(folderPath);
  if (!folder) return;
  const settings = readFolderGraphSettings();
  const isRemoved = (path: string) => path === folder || path.startsWith(folder + "/");
  settings.visibleFolders = settings.visibleFolders.filter((path) => !isRemoved(path));
  const next: Record<string, FolderGraphSelections> = {};
  for (const [path, choice] of Object.entries(settings.selections)) {
    if (isRemoved(path)) continue;
    next[path] = { noteIds: choice.noteIds, childFolders: choice.childFolders.filter((child) => !isRemoved(child)) };
  }
  settings.selections = next;
  writeFolderGraphSettings(settings);
}

function pushGraphLink(links: GraphLink[], unique: Set<string>, from: string, to: string): void {
  if (from === to) return;
  const key = [from, to].sort().join("|");
  if (unique.has(key)) return;
  unique.add(key);
  links.push({ source: from, target: to, kind: "folder" });
}

/**
 * 為現有圖譜疊加已選用的關聯，絕不改動原有 Wikilink。
 * includedFolders 若提供則僅呈現該組資料夾（用於局部圖譜）。
 */
export function addFolderLinksToGraph(
  graph: GraphData,
  notes: GraphNote[],
  settings: FolderGraphSettings,
  availablePaths: string[],
  options: { includedFolders?: string[]; centeredFolder?: string } = {}
): GraphData {
  const available = new Set(availablePaths.map(normalizeGraphFolderPath));
  const enabled = new Set(settings.visibleFolders.filter((path) => available.has(path)));
  // 子資料夾即使沒有自行打開「顯示」，仍可作為已選取的父子連線終點。
  for (const [parent, item] of Object.entries(settings.selections)) {
    if (!enabled.has(parent)) continue;
    for (const child of item.childFolders) if (available.has(child)) enabled.add(child);
  }
  if (options.includedFolders) {
    const scope = new Set(options.includedFolders.map(normalizeGraphFolderPath));
    for (const path of enabled) if (!scope.has(path)) enabled.delete(path);
  }
  if (!enabled.size) return graph;

  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = [...graph.links];
  const ids = new Set(nodes.map((node) => node.id));
  const seenLinks = new Set(links.map((link) => [link.source, link.target].sort().join("|")));
  const graphNotes = new Map(notes.filter((note) => ids.has(note.id)).map((note) => [note.id, note]));

  for (const path of enabled) {
    const folderId = getGraphFolderNodeId(path);
    if (ids.has(folderId)) continue;
    const entry = settings.selections[path];
    const members = (entry?.noteIds || []).map((id) => graphNotes.get(id))
      .filter((note): note is GraphNote => note !== undefined && normalizeGraphFolderPath(note.folder || "") === path);
    const memberNodes = members.map((note) => nodes.find((node) => node.id === note.id))
      .filter((node): node is GraphNode => Boolean(node));
    const x = options.centeredFolder === path ? 0 : memberNodes.length
      ? memberNodes.reduce((sum, node) => sum + node.x, 0) / memberNodes.length : -100 + enabled.size * 10;
    const y = options.centeredFolder === path ? 0 : memberNodes.length
      ? memberNodes.reduce((sum, node) => sum + node.y, 0) / memberNodes.length - 55 : -100;
    nodes.push({ id: folderId, label: `📁 ${path.split("/").pop() || path}`, type: "folder", folderPath: path,
      x, y, vx: 0, vy: 0, radius: 13, connectionsCount: 0 });
    ids.add(folderId);
  }

  for (const folder of enabled) {
    const source = getGraphFolderNodeId(folder);
    const choices = settings.selections[folder];
    if (!choices) continue;
    for (const noteId of choices.noteIds) {
      const note = graphNotes.get(noteId);
      if (note && normalizeGraphFolderPath(note.folder || "") === folder) {
        pushGraphLink(links, seenLinks, source, noteId);
      }
    }
    for (const child of choices.childFolders) {
      if (getGraphFolderParent(child) === folder && enabled.has(child) && ids.has(getGraphFolderNodeId(child))) {
        pushGraphLink(links, seenLinks, source, getGraphFolderNodeId(child));
      }
    }
  }
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.source, (counts.get(link.source) || 0) + 1);
    counts.set(link.target, (counts.get(link.target) || 0) + 1);
  }
  return { nodes: nodes.map((node) => ({ ...node,
    connectionsCount: counts.get(node.id) || 0,
    radius: node.type === "folder" ? Math.min(24, Math.max(13, 12 + (counts.get(node.id) || 0) * 1.3)) : node.radius
  })), links };
}

/** 以資料夾為中心，僅顯示選取的直屬筆記及已選取的直屬子資料夾。 */
export function buildFolderLocalGraph(
  folderPath: string,
  allNotes: GraphNote[],
  settings: FolderGraphSettings,
  availablePaths: string[],
  maxNodes: number = 300
): GraphData & { isCapped: boolean } {
  const path = normalizeGraphFolderPath(folderPath);
  const choices = settings.selections[path] || { noteIds: [], childFolders: [] };
  const noteIds = new Set(choices.noteIds);
  const validMembers = allNotes.filter((note) => noteIds.has(note.id) && normalizeGraphFolderPath(note.folder || "") === path);
  const members = validMembers.slice(0, maxNodes);
  const base = buildGraphData(members, maxNodes);
  const visible = new Set(members.map((note) => note.id));
  const trimmed: GraphData = {
    nodes: base.nodes.filter((node) => visible.has(node.id)),
    links: base.links.filter((link) => visible.has(link.source) && visible.has(link.target)),
  };
  const folderScope = [path, ...choices.childFolders.filter((child) => getGraphFolderParent(child) === path)];
  const localized = addFolderLinksToGraph(trimmed, members, settings, availablePaths, { includedFolders: folderScope, centeredFolder: path });
  // 沒有選取任何直屬筆記時，仍應顯示該資料夾本身。
  if (!localized.nodes.some((node) => node.id === getGraphFolderNodeId(path))) {
    localized.nodes.unshift({ id: getGraphFolderNodeId(path), label: `📁 ${path.split("/").pop() || path}`, type: "folder", folderPath: path,
      x: 0, y: 0, vx: 0, vy: 0, radius: 13, connectionsCount: 0 });
  }
  return { ...localized, isCapped: validMembers.length > maxNodes };
}
