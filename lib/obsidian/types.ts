export interface Note {
  id: string;
  title: string;
  content: string;
  folder?: string;
  tags: string[];
  outlinks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteMetadata {
  id: string;
  title: string;
  folder?: string;
  tags: string[];
  outlinks: string[];
  summary?: string;
  charCount?: number;
  wordCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAttachment {
  id: string;
  filename: string;
  mimeType: string;
  blob: Blob;
  size: number;
  createdAt: string;
}

export interface BacklinkItem {
  sourceNoteId: string;
  sourceNoteTitle: string;
  contextSnippet: string;
}

// folder 為圖譜專用虛擬節點，不是筆記，不參與 [[Wikilink]] 解析。
export type GraphNodeType = "note" | "tag" | "unresolved" | "folder";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  folderPath?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  connectionsCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind?: "folder";
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SerializedMediaAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string;
}

export interface VaultBackup {
  version: 1 | 2;
  exportedAt: string;
  vaultName: string;
  notes: Note[];
  customFolders?: string[];
  media?: SerializedMediaAttachment[];
}

export type ViewMode = "edit" | "preview" | "split" | "graph";

export interface FolderNode {
  path: string;
  name: string;
  subfolders: FolderNode[];
  notes: NoteMetadata[];
}
