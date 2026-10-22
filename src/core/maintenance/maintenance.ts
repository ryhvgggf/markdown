import * as Y from 'yjs'
import type { NotesDb } from '@/adapters/storage/db'
import { StorageError, toStorageError, type StorageAdapter } from '@/adapters/storage/types'
import { extractNote } from '../extract/extract'
import type { Indexer } from '../indexer/indexer'
import type { NoteDocCache } from '../note-doc/cache'
import type { Vault } from '../vault/vault'

/** Bump when derived index data changes shape; startup maintenance then rebuilds it once. */
export const INDEX_VERSION = 2
export const INDEX_VERSION_KEY = 'indexVersion'
/** meta: ids of notes whose permanent delete has started but not finished (crash-safe purge). */
export const PENDING_PURGE_KEY = 'pendingPurge'
/** meta: time of the last attachment garbage collection (an O(vault) scan, so at most daily). */
export const LAST_ATTACHMENT_GC_KEY = 'lastAttachmentGc'
export const ATTACHMENT_GC_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface MaintenanceDeps {
  db: NotesDb
  storage: StorageAdapter
  vault: Vault
  notes: NoteDocCache
  indexer: Indexer
  onError?: (e: StorageError) => void
  now?: () => number
}

export interface MaintenanceReport {
  /** Notes that could not be read (corrupt); they are skipped, never block anything. */
  unreadable: string[]
}

/**
 * Derived-data and clean-up work. Everything here is best-effort: each step catches its own errors,
 * reports storage failures and moves on, so a corrupt note or a failing store never stops the app.
 */
export class Maintenance {
  private readonly now: () => number
  private background: Promise<unknown> = Promise.resolve()

  constructor(private readonly d: MaintenanceDeps) {
    this.now = d.now ?? Date.now
  }

  /** Startup pass; run it after the first render (it is O(dirty notes), plus O(vault) at most once a day). */
  async runStartup(): Promise<MaintenanceReport> {
    const { vault, indexer, db } = this.d
    const unreadable = new Set<string>()
    const now = this.now()

    // 1. permanent deletes interrupted last time, then trash older than 30 days
    await this.step(async () => {
      const pending = await this.pendingPurges()
      if (pending.length) await this.finishPurge(pending)
    })
    await this.step(async () => {
      const expired = vault.expiredNoteIds(now)
      await this.addPending(expired)
      vault.purgeExpired(now)
      await this.finishPurge(expired)
    })

    // 2. derived index: one rebuild after a version bump (or an empty index), then the dirty-note catch-up
    await this.step(async () => {
      const stored = (await db.meta.get(INDEX_VERSION_KEY))?.value
      if (stored !== INDEX_VERSION || (vault.listNotes().length > 0 && (await db.noteText.count()) === 0)) {
        if (vault.listNotes({ includeTrashed: true }).length > 0) {
          for (const id of (await indexer.rebuildAll()).failed) unreadable.add(id)
        }
        await db.meta.put({ key: INDEX_VERSION_KEY, value: INDEX_VERSION })
      }
    })
    await this.step(async () => {
      for (const id of (await indexer.catchUp()).failed) unreadable.add(id)
    })

    // 3. two tabs may have given notes the same title at the same time
    await this.step(async () => void vault.resolveDuplicateTitles())

    // 4. attachment GC (R8: unreferenced AND older than 30 days), at most once a day
    await this.step(async () => {
      if (!vault.hasStaleAttachments(now)) return
      const last = (await db.meta.get(LAST_ATTACHMENT_GC_KEY))?.value
      if (typeof last === 'number' && now - last < ATTACHMENT_GC_INTERVAL_MS) return
      await db.meta.put({ key: LAST_ATTACHMENT_GC_KEY, value: now })
      const refs = await indexer.referencedAttachmentIds()
      if (!refs) return // some note is unreadable and may reference any of them: purge nothing
      await this.deleteAttachments(vault.unreferencedAttachmentIds(now, refs))
    })

    if (unreadable.size) console.warn(`[maintenance] skipped ${unreadable.size} unreadable note(s)`, [...unreadable])
    return { unreadable: [...unreadable] }
  }

  /**
   * Permanent delete from the trash. Crash-safe: the ids are recorded first, the vault entry goes next
   * (the note disappears at once), then doc and index rows; a startup pass finishes an interrupted run.
   * The note's attachments are deleted afterwards in the background when no other note references them.
   * Never rejects: failures are reported through `onError`; returns whether everything was removed.
   */
  async purge(ref: { kind: 'note' | 'folder'; id: string }): Promise<boolean> {
    const { vault } = this.d
    try {
      const noteIds = ref.kind === 'note' ? [ref.id] : vault.folderNoteIds(ref.id)
      const candidates = new Set<string>()
      for (const id of noteIds) for (const a of await this.attachmentsOf(id)) candidates.add(a)
      await this.addPending(noteIds)
      if (ref.kind === 'note') vault.purgeNote(ref.id)
      else vault.purgeFolder(ref.id)
      await this.finishPurge(noteIds)
      if (candidates.size) this.inBackground(() => this.deleteIfUnreferenced(candidates))
      return true
    } catch (e) {
      this.report(e)
      return false
    }
  }

  /**
   * Two tabs can give notes the same title at the same moment (each checked its own vault first).
   * Resolve such duplicates shortly after any vault change; deterministic, so tabs agree on the result.
   */
  watchDuplicateTitles(delayMs = 1000): () => void {
    let t: ReturnType<typeof setTimeout> | null = null
    const off = this.d.vault.observe(() => {
      if (t !== null) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        try {
          this.d.vault.resolveDuplicateTitles()
        } catch (e) {
          this.report(e)
        }
      }, delayMs)
    })
    return () => {
      off()
      if (t !== null) clearTimeout(t)
    }
  }

  /** Resolves when background work started by `purge` has finished (tests). */
  idle(): Promise<void> {
    return this.background.then(() => undefined)
  }

  private async finishPurge(noteIds: string[]): Promise<void> {
    const { vault, notes, indexer } = this.d
    for (const id of noteIds) {
      if (vault.getNote(id)) vault.purgeNote(id) // recorded but the vault change was never stored
      await notes.remove(id)
      await indexer.removeNote(id)
    }
    await this.updatePending((ids) => ids.filter((x) => !noteIds.includes(x)))
  }

  private async pendingPurges(): Promise<string[]> {
    const v = (await this.d.db.meta.get(PENDING_PURGE_KEY))?.value
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  private addPending(noteIds: string[]): Promise<void> {
    if (!noteIds.length) return Promise.resolve()
    return this.updatePending((ids) => [...new Set([...ids, ...noteIds])])
  }

  private async updatePending(fn: (ids: string[]) => string[]): Promise<void> {
    const { db } = this.d
    await db.transaction('rw', db.meta, async () => {
      const before = await this.pendingPurges()
      const after = fn(before)
      if (after.length === before.length && after.every((x, i) => x === before[i])) return
      if (after.length) await db.meta.put({ key: PENDING_PURGE_KEY, value: after })
      else await db.meta.delete(PENDING_PURGE_KEY)
    })
  }

  private async attachmentsOf(noteId: string): Promise<string[]> {
    const cached = this.d.notes.peek(noteId)
    const doc = cached ?? new Y.Doc()
    try {
      if (!cached) for (const u of await this.d.storage.loadDoc(noteId)) Y.applyUpdate(doc, u)
      return extractNote(doc.getXmlFragment('content')).attachmentIds
    } catch {
      return [] // unreadable: its attachments are left to the daily GC
    } finally {
      if (!cached) doc.destroy()
    }
  }

  private async deleteIfUnreferenced(candidates: Set<string>): Promise<void> {
    const refs = await this.d.indexer.referencedAttachmentIds()
    if (!refs) return
    await this.deleteAttachments([...candidates].filter((id) => !refs.has(id) && this.d.vault.getAttachment(id)))
  }

  /** Blob first, metadata second: a crash in between leaves metadata the next GC removes, never a lost blob. */
  private async deleteAttachments(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.step(async () => {
        await this.d.storage.deleteBlob(id)
        this.d.vault.removeAttachment(id)
      })
    }
  }

  private inBackground(fn: () => Promise<void>): void {
    this.background = this.background.then(fn).catch((e) => this.report(e))
  }

  private async step(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      this.report(e)
    }
  }

  private report(e: unknown): void {
    console.warn('[maintenance]', e)
    this.d.onError?.(e instanceof StorageError ? e : toStorageError(e))
  }
}
