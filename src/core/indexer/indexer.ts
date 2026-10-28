import Dexie from 'dexie'
import * as Y from 'yjs'
import { StorageError, toStorageError, type StorageAdapter } from '@/adapters/storage/types'
import type { AttachmentRefRow, BlockRow, LinkRow, NoteTextRow, NotesDb, TagRow } from '@/adapters/storage/db'
import type { Vault } from '../vault/vault'
import type { NoteDocCache } from '../note-doc/cache'
import { extractNote } from '../extract/extract'
import { onIdle } from '../idle'

export type { AttachmentRefRow, BlockRow, LinkRow, NoteTextRow, TagRow }

const DEFAULT_DEBOUNCE_MS = 1000
const MIRROR_PAGE = 100
/** meta key prefix of the persisted "index is behind this note" marker (survives a quick close/reload). */
export const DIRTY_PREFIX = 'dirty:'

export interface IndexerOptions {
  debounceMs?: number
  /** Storage failures of background indexing (the note stays dirty and is retried on the next start). */
  onError?: (e: StorageError) => void
}

/** Result of a bulk pass: ids of notes that could not be read (corrupt or storage error) and were skipped. */
/** Options of bulk O(vault) passes: `pause` runs between notes so background work yields to the UI. */
export interface BulkOptions {
  pause?: () => Promise<void>
}

export interface IndexPassResult {
  failed: string[]
}

type RowState = { title: string; updatedAt: number; trashed: boolean }

/**
 * Keeps the derived Dexie tables (noteText, links, blocks, tags, attachmentRefs) in sync with the Yjs documents.
 * Trashed notes keep their rows; rows are removed only once the note is gone from the vault.
 */
export class Indexer {
  private readonly debounceMs: number
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private syncChain: Promise<void> = Promise.resolve()
  /** Mirror of noteText's title/updatedAt/trashed, so vault changes do not re-read the whole table (M4). */
  private rows: Map<string, RowState> | null = null
  private readonly onError?: (e: StorageError) => void
  private readonly indexedListeners = new Set<(noteId: string) => void>()

  constructor(
    private readonly db: NotesDb,
    private readonly vault: Vault,
    private readonly notes: NoteDocCache,
    private readonly storage: StorageAdapter,
    opts: IndexerOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.onError = opts.onError
  }

  start(): () => void {
    const offDoc = this.notes.onChange((noteId) => this.schedule(noteId))
    const offVault = this.vault.observe(() => void this.queueSync())
    return () => {
      offDoc()
      offVault()
      for (const t of this.timers.values()) clearTimeout(t)
      this.timers.clear()
    }
  }

  /** Called after a note's index rows are written (the folder mirror writes the file then). */
  onIndexed(cb: (noteId: string) => void): () => void {
    this.indexedListeners.add(cb)
    return () => this.indexedListeners.delete(cb)
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
    for (const cb of this.indexedListeners) cb(noteId)
  }

  async removeNote(noteId: string): Promise<void> {
    const t = this.timers.get(noteId)
    if (t !== undefined) clearTimeout(t)
    this.timers.delete(noteId)
    const { noteText, links, blocks, tags, attachmentRefs, meta } = this.db
    await this.db.transaction('rw', [noteText, links, blocks, tags, attachmentRefs, meta], async () => {
      await noteText.delete(noteId)
      await links.where('sourceNoteId').equals(noteId).delete()
      await blocks.where('noteId').equals(noteId).delete()
      await tags.where('[noteId+tag]').between([noteId, ''], [noteId, '￿']).delete()
      await attachmentRefs.where('[noteId+attachmentId]').between([noteId, ''], [noteId, '￿']).delete()
      await meta.delete(DIRTY_PREFIX + noteId)
    })
    this.rows?.delete(noteId)
  }

  /**
   * Recomputes every derived table (from the cached doc when open, else storage) and drops rows of vanished notes.
   * A note that cannot be read is skipped (its old rows stay) and reported in `failed`.
   */
  async rebuildAll(opts: BulkOptions = {}): Promise<IndexPassResult> {
    const live = new Set(this.vault.listNotes({ includeTrashed: true }).map((n) => n.id))
    for (const row of await this.db.noteText.toArray()) if (!live.has(row.noteId)) await this.removeNote(row.noteId)
    const failed: string[] = []
    for (const id of live) {
      await opts.pause?.()
      // An open doc may hold edits not stored yet: index those, never older stored text.
      const cached = this.notes.peek(id)
      let doc: Y.Doc
      try {
        doc = cached ?? (await this.loadTemp(id))
      } catch {
        failed.push(id)
        continue
      }
      try {
        const meta = this.vault.getNote(id)
        if (meta) await this.write(id, meta.title, meta.updatedAt, doc)
      } finally {
        if (!cached) doc.destroy()
      }
    }
    return { failed }
  }

  /**
   * Attachment ids referenced by ALL notes, trashed-but-unexpired included, read from the cached doc
   * when loaded (it may hold references not yet persisted) and from storage otherwise. Ids are not stored
   * in a table, so this is O(vault): run it in the background only. Returns `undefined` when any note
   * cannot be read, because that note may reference attachments (callers must then purge nothing).
   */
  async referencedAttachmentIds(opts: BulkOptions = {}): Promise<Set<string> | undefined> {
    const ids = new Set<string>()
    for (const n of this.vault.listNotes({ includeTrashed: true })) {
      await opts.pause?.()
      const cached = this.notes.peek(n.id)
      let doc: Y.Doc
      try {
        doc = cached ?? (await this.loadTemp(n.id))
      } catch {
        return undefined
      }
      try {
        for (const a of extractNote(doc.getXmlFragment('content')).attachmentIds) ids.add(a)
      } finally {
        if (!cached) doc.destroy()
      }
    }
    return ids
  }

  /**
   * Startup catch-up: re-indexes notes whose dirty marker survived the last session (edits made just
   * before closing), drops markers of vanished notes, then syncs titles/trashed state with the vault once.
   */
  async catchUp(opts: BulkOptions = {}): Promise<IndexPassResult> {
    const keys = (await this.db.meta.where('key').startsWith(DIRTY_PREFIX).primaryKeys()) as string[]
    const failed: string[] = []
    for (const key of keys) {
      const id = key.slice(DIRTY_PREFIX.length)
      try {
        await this.indexNote(id)
      } catch (e) {
        failed.push(id)
        this.report(e)
      }
    }
    await this.loadRowMirror(opts)
    await this.queueSync()
    return { failed }
  }

  /** Builds the noteText mirror in pages, pausing in between (the rows carry full note text). */
  private async loadRowMirror(opts: BulkOptions): Promise<void> {
    if (this.rows) return
    const rows = new Map<string, RowState>()
    let after: string | null = null
    for (;;) {
      await opts.pause?.()
      const page: NoteTextRow[] =
        after === null
          ? await this.db.noteText.orderBy('noteId').limit(MIRROR_PAGE).toArray()
          : await this.db.noteText.where('noteId').above(after).limit(MIRROR_PAGE).toArray()
      for (const r of page) rows.set(r.noteId, { title: r.title, updatedAt: r.updatedAt, trashed: r.trashed ?? false })
      if (page.length < MIRROR_PAGE) break
      after = page[page.length - 1].noteId
    }
    this.rows ??= rows
  }

  /** Indexes every note with a pending debounce timer now (best-effort, e.g. on pagehide). */
  async flushPending(): Promise<void> {
    const ids = [...this.timers.keys()]
    for (const id of ids) {
      clearTimeout(this.timers.get(id))
      this.timers.delete(id)
    }
    await Promise.all(ids.map((id) => this.indexNote(id).catch((e) => this.report(e))))
  }

  private schedule(noteId: string): void {
    const prev = this.timers.get(noteId)
    if (prev !== undefined) clearTimeout(prev)
    // First edit of a debounce window: persist the marker so a close/reload before indexing is caught up
    // (in idle time: never inside the keystroke that caused it).
    else onIdle(() => void this.db.meta.put({ key: DIRTY_PREFIX + noteId, value: 1 }).catch((e) => this.report(e)))
    this.timers.set(
      noteId,
      setTimeout(() => {
        // Still listed until it actually runs, so flushPending (pagehide) can take it over.
        onIdle(() => {
          if (this.timers.get(noteId) !== timer) return
          this.timers.delete(noteId)
          void this.indexNote(noteId).catch((e) => this.report(e))
        })
      }, this.debounceMs),
    )
    const timer = this.timers.get(noteId)
  }

  private report(e: unknown): void {
    // Undecodable note bytes are shown per note by the editor; only storage failures go to the banner.
    if (e instanceof StorageError || e instanceof Dexie.DexieError || e instanceof DOMException) {
      this.onError?.(toStorageError(e))
    }
  }

  private queueSync(): Promise<void> {
    this.syncChain = this.syncChain.then(() => this.syncWithVault()).catch((e) => this.report(e))
    return this.syncChain
  }

  /**
   * Vault changed: drop rows of purged notes, and make sure every vault note (trashed included) has a
   * row whose title/updatedAt match the vault, creating a title-only row when none exists yet.
   */
  private async syncWithVault(): Promise<void> {
    const metas = new Map(this.vault.listNotes({ includeTrashed: true }).map((n) => [n.id, n]))
    await this.loadRowMirror({})
    const rows = this.rows!
    for (const id of [...rows.keys()]) if (!metas.has(id)) await this.removeNote(id)
    for (const meta of metas.values()) {
      const row = rows.get(meta.id)
      const trashed = meta.deletedAt !== null
      if (row && row.title === meta.title && row.updatedAt === meta.updatedAt && row.trashed === trashed) continue
      await this.db.transaction('rw', this.db.noteText, async () => {
        const cur = await this.db.noteText.get(meta.id)
        if (!this.vault.getNote(meta.id)) return
        if (!cur) await this.db.noteText.put({ noteId: meta.id, title: meta.title, text: '', updatedAt: meta.updatedAt, trashed })
        else await this.db.noteText.update(meta.id, { title: meta.title, updatedAt: meta.updatedAt, trashed })
      })
      rows.set(meta.id, { title: meta.title, updatedAt: meta.updatedAt, trashed })
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
    const { noteText, links, blocks, tags, attachmentRefs, meta } = this.db
    const refRows: AttachmentRefRow[] = x.attachmentIds.map((attachmentId) => ({ noteId, attachmentId }))
    const linkRows: LinkRow[] = x.links.map((l) => ({ sourceNoteId: noteId, ...l }))
    const blockRows: BlockRow[] = x.blocks.map((b) => ({ noteId, blockId: b.id, type: b.type, text: b.text }))
    const tagRows: TagRow[] = x.tags.map((tag) => ({ noteId, tag }))
    let written: RowState | null = null
    await this.db.transaction('rw', [noteText, links, blocks, tags, attachmentRefs, meta], async () => {
      // The note may have been purged while we were loading; never recreate rows for it.
      const live = this.vault.getNote(noteId)
      if (!live) return
      title = live.title
      updatedAt = live.updatedAt
      written = { title, updatedAt, trashed: live.deletedAt !== null }
      // Clear the dirty marker with the rows, unless a newer edit is already scheduled (it re-marks).
      if (!this.timers.has(noteId)) await meta.delete(DIRTY_PREFIX + noteId)
      await noteText.put({ noteId, title, text: x.text, updatedAt, trashed: live.deletedAt !== null })
      await links.where('sourceNoteId').equals(noteId).delete()
      await blocks.where('noteId').equals(noteId).delete()
      await tags.where('[noteId+tag]').between([noteId, ''], [noteId, '￿']).delete()
      await attachmentRefs.where('[noteId+attachmentId]').between([noteId, ''], [noteId, '￿']).delete()
      await links.bulkAdd(linkRows)
      await blocks.bulkPut(blockRows)
      await tags.bulkPut(tagRows)
      await attachmentRefs.bulkPut(refRows)
    })
    if (written) this.rows?.set(noteId, written)
  }
}
