import * as Y from 'yjs'
import type { StorageAdapter } from '@/adapters/storage/types'
import type { BlockRow, LinkRow, NoteTextRow, NotesDb, TagRow } from '@/adapters/storage/db'
import type { Vault } from '../vault/vault'
import type { NoteDocCache } from '../note-doc/cache'
import { extractNote } from '../extract/extract'

export type { BlockRow, LinkRow, NoteTextRow, TagRow }

const DEFAULT_DEBOUNCE_MS = 1000

/**
 * Keeps the derived Dexie tables (noteText, links, blocks, tags) in sync with the Yjs documents.
 * Trashed notes keep their rows; rows are removed only once the note is gone from the vault.
 */
export class Indexer {
  private readonly debounceMs: number
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private syncChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: NotesDb,
    private readonly vault: Vault,
    private readonly notes: NoteDocCache,
    private readonly storage: StorageAdapter,
    opts: { debounceMs?: number } = {},
  ) {
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  start(): () => void {
    const offDoc = this.notes.onChange((noteId) => this.schedule(noteId))
    const offVault = this.vault.observe(() => {
      this.syncChain = this.syncChain.then(() => this.syncWithVault()).catch(() => {})
    })
    return () => {
      offDoc()
      offVault()
      for (const t of this.timers.values()) clearTimeout(t)
      this.timers.clear()
    }
  }

  async indexNote(noteId: string): Promise<void> {
    const meta = this.vault.getNote(noteId)
    if (!meta) return this.removeNote(noteId)
    const cached = this.notes.peek(noteId)
    const doc = cached ?? (await this.loadTemp(noteId))
    try {
      await this.write(noteId, meta.title, meta.updatedAt, doc)
    } finally {
      if (!cached) doc.destroy()
    }
  }

  async removeNote(noteId: string): Promise<void> {
    const t = this.timers.get(noteId)
    if (t !== undefined) clearTimeout(t)
    this.timers.delete(noteId)
    const { noteText, links, blocks, tags } = this.db
    await this.db.transaction('rw', [noteText, links, blocks, tags], async () => {
      await noteText.delete(noteId)
      await links.where('sourceNoteId').equals(noteId).delete()
      await blocks.where('noteId').equals(noteId).delete()
      await tags.where('[noteId+tag]').between([noteId, ''], [noteId, '￿']).delete()
    })
  }

  /** Recomputes every derived table from storage (bypasses the doc cache) and drops rows of vanished notes. */
  async rebuildAll(): Promise<void> {
    const live = new Set(this.vault.listNotes({ includeTrashed: true }).map((n) => n.id))
    for (const row of await this.db.noteText.toArray()) if (!live.has(row.noteId)) await this.removeNote(row.noteId)
    for (const id of live) {
      const doc = await this.loadTemp(id)
      try {
        const meta = this.vault.getNote(id)
        if (meta) await this.write(id, meta.title, meta.updatedAt, doc)
      } finally {
        doc.destroy()
      }
    }
  }

  /**
   * Attachment ids referenced by ALL notes, trashed-but-unexpired included. Ids are not stored in a
   * table (schema is fixed), so each note is re-extracted from storage; intended to run once at startup.
   */
  async referencedAttachmentIds(): Promise<Set<string>> {
    const ids = new Set<string>()
    for (const n of this.vault.listNotes({ includeTrashed: true })) {
      const doc = await this.loadTemp(n.id)
      try {
        for (const a of extractNote(doc.getXmlFragment('content')).attachmentIds) ids.add(a)
      } finally {
        doc.destroy()
      }
    }
    return ids
  }

  private schedule(noteId: string): void {
    const prev = this.timers.get(noteId)
    if (prev !== undefined) clearTimeout(prev)
    this.timers.set(
      noteId,
      setTimeout(() => {
        this.timers.delete(noteId)
        void this.indexNote(noteId).catch(() => {})
      }, this.debounceMs),
    )
  }

  /** Vault changed: refresh renamed titles and drop rows of notes purged from the vault. */
  private async syncWithVault(): Promise<void> {
    const metas = new Map(this.vault.listNotes({ includeTrashed: true }).map((n) => [n.id, n]))
    for (const row of await this.db.noteText.toArray()) {
      const meta = metas.get(row.noteId)
      if (!meta) await this.removeNote(row.noteId)
      else if (meta.title !== row.title) await this.db.noteText.update(row.noteId, { title: meta.title })
    }
  }

  private async loadTemp(noteId: string): Promise<Y.Doc> {
    const doc = new Y.Doc()
    for (const u of await this.storage.loadDoc(noteId)) Y.applyUpdate(doc, u)
    doc.getXmlFragment('content')
    return doc
  }

  private async write(noteId: string, title: string, updatedAt: number, doc: Y.Doc): Promise<void> {
    const x = extractNote(doc.getXmlFragment('content'))
    const { noteText, links, blocks, tags } = this.db
    const linkRows: LinkRow[] = x.links.map((l) => ({ sourceNoteId: noteId, ...l }))
    const blockRows: BlockRow[] = x.blocks.map((b) => ({ noteId, blockId: b.id, type: b.type, text: b.text }))
    const tagRows: TagRow[] = x.tags.map((tag) => ({ noteId, tag }))
    await this.db.transaction('rw', [noteText, links, blocks, tags], async () => {
      await noteText.put({ noteId, title, text: x.text, updatedAt })
      await links.where('sourceNoteId').equals(noteId).delete()
      await blocks.where('noteId').equals(noteId).delete()
      await tags.where('[noteId+tag]').between([noteId, ''], [noteId, '￿']).delete()
      await links.bulkAdd(linkRows)
      await blocks.bulkPut(blockRows)
      await tags.bulkPut(tagRows)
    })
  }
}
