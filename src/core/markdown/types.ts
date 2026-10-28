/** ProseMirror JSON in the editor's schema, as plain data (no schema needed to build or read it). */
export type PMMark = { type: string; attrs?: Record<string, unknown> }
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; marks?: PMMark[]; text?: string }

/** Placeholder emitted by parseMarkdown(), replaced by resolveRefs(); never stored. */
export type RefNode = {
  type: 'wikiRef' | 'embedRef'
  attrs: { target: string; heading: string | null; anchor: string | null; alias: string | null; width: number | null; raw: string }
}

/** One file of an import / export: a path relative to the root, with text (.md / .json) or binary content. */
export type FileEntry = { path: string; text?: string; blob?: Blob; mtime?: number }

export type ParseResult = { doc: PMNode; tags: string[]; created: number | null; updated: number | null; lossy: string[] }
