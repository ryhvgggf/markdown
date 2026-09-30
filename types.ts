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

export type GraphNodeType = "note" | "tag" | "unresolved";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
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
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface VaultBackup {
  version: 1;
  exportedAt: string;
  vaultName: string;
  notes: Note[];
}

export type ViewMode = "edit" | "preview" | "split" | "graph";

export interface FolderNode {
  path: string;
  name: string;
  subfolders: FolderNode[];
  notes: NoteMetadata[];
}
