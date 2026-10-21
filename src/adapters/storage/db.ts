import Dexie, { type Table } from 'dexie'

export interface UpdateRow { seq?: number; docId: string; update: Uint8Array }
export interface SnapshotRow { docId: string; state: Uint8Array }
export interface BlobRow { id: string; blob: Blob }
export interface NoteTextRow { noteId: string; title: string; text: string; updatedAt: number }
export interface LinkRow {
  id?: number
  sourceNoteId: string
  sourceBlockId: string
  targetNoteId: string
  targetBlockId: string | null
  snippet: string
}
export interface BlockRow { noteId: string; blockId: string; type: string; text: string }
export interface TagRow { noteId: string; tag: string }
export interface MetaRow { key: string; value: unknown }

export class NotesDb extends Dexie {
  updates!: Table<UpdateRow, number>
  snapshots!: Table<SnapshotRow, string>
  blobs!: Table<BlobRow, string>
  noteText!: Table<NoteTextRow, string>
  links!: Table<LinkRow, number>
  blocks!: Table<BlockRow, [string, string]>
  tags!: Table<TagRow, [string, string]>
  meta!: Table<MetaRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      updates: '++seq, docId',
      snapshots: 'docId',
      blobs: 'id',
      noteText: 'noteId',
      links: '++id, sourceNoteId, targetNoteId, [targetNoteId+targetBlockId]',
      blocks: '[noteId+blockId], noteId',
      tags: '[noteId+tag], tag',
      meta: 'key',
    })
  }
}

export function createDb(name = 'notes-v2'): NotesDb {
  return new NotesDb(name)
}
