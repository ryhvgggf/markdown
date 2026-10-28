import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import type { FileEntry, ParseResult, PMNode } from '@/core/markdown/types'
import type { Vault } from '@/core/vault/vault'

/** Reads and writes note content as ProseMirror JSON (implemented in app/, where the editor schema lives). */
export interface DocIO {
  /** A note without stored content yet: validates against the schema, stores it, marks it for indexing. */
  write(noteId: string, doc: PMNode): Promise<void>
  /** An existing note (possibly open in an editor): replaces its content in one transaction. */
  replace(noteId: string, doc: PMNode): Promise<void>
  read(noteId: string): Promise<PMNode>
}

export type ImportKind = 'markdown' | 'v2' | 'v1'

export type ImportSource = {
  kind: ImportKind
  /** Paths already normalized (normalizeZipPath); `.md` files carry text, others a blob. */
  entries: FileEntry[]
  manifest?: V2Manifest
  /** Keyed by entry path (v1 ZIP). */
  noteMeta?: Map<string, { title?: string; createdAt: number; updatedAt: number }>
  /** 'a/b' — folders kept even when empty. */
  emptyFolders?: string[]
}

export type PlannedNote = {
  path: string
  noteId: string
  title: string
  folderPath: string[]
  /** Title would get a suffix (estimated for the preview: existing notes counted as copies). */
  renamedFrom?: string
  /** Manifest id already in the vault. */
  existing?: boolean
}

export type ImportPlan = {
  jobId: string
  notes: PlannedNote[]
  folders: string[][]
  attachments: { path: string; attachmentId: string; size: number; skipped?: 'too-large' }[]
  unresolved: { notePath: string; raw: string }[]
  aliased: { notePath: string; raw: string }[]
  existingCount: number
  /** Parsed (or manifest-restored) documents, keyed by note path. Not shown in the preview. */
  parsed: Map<string, ParseResult>
  /** Paths whose document came verbatim from the manifest (real ids, no placeholders). */
  exact: Set<string>
}

export type ImportChoices = {
  destination: { kind: 'new-dated' } | { kind: 'folder'; folderId: string | null }
  /** Required when the plan has existing notes. */
  onExisting: 'overwrite' | 'copy' | null
}

export type ImportReport = {
  notes: number
  folders: number
  attachments: number
  renamed: { from: string; to: string; noteId: string }[]
  unresolved: { noteId: string; raw: string }[]
  aliased: { noteId: string; raw: string }[]
  lossy: { noteId: string; syntax: string }[]
  skipped: { path: string; reason: string }[]
  /** Folder the import went into (null: vault root). */
  folderId: string | null
}

export type V2ManifestNote = {
  id: string
  path: string
  /** The real title (the file name may have lost characters such as `/`). */
  title: string
  createdAt: number
  updatedAt: number
  mdHash: string
  /** Block ids in document order (applied when the .md is unchanged but `doc` is absent). */
  blockIds: string[]
  /** The exact document (ZIP export only). */
  doc?: PMNode
}

export type V2Manifest = {
  format: 'notes-v2'
  version: 1
  exportedAt: number
  folders: { id: string; path: string; order: number }[]
  notes: V2ManifestNote[]
  attachments: { id: string; path: string; filename: string; mimeType: string; createdAt: number }[]
}

export const MANIFEST_PATH = '.notes-v2.json'
export const IMPORT_JOB_KEY = 'importJob'

export type ImportDeps = {
  vault: Vault
  storage: StorageAdapter
  db: NotesDb
  docs: DocIO
  parse(files: { path: string; text: string; dialect?: 'v1' }[]): Promise<ParseResult[]>
  now?: () => number
}
