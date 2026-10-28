import * as Y from 'yjs'
import type { NotesDb } from '@/adapters/storage/db'
import { StorageError, toStorageError, type StorageAdapter } from '@/adapters/storage/types'
import { extractNote } from '../extract/extract'
import type { Indexer } from '../indexer/indexer'
import type { NoteDocCache } from '../note-doc/cache'
import type { Vault } from '../vault/vault'

/** Bump when derived index data changes shape; startup maintenance then rebuilds it once. */
/** 3: link snippet tokens carry the target block id. 4: attachmentRefs (which notes use which attachment). */
export const INDEX_VERSION = 4
export const INDEX_VERSION_KEY = 'indexVersion'
/** meta: ids of notes whose permanent delete has started but not finished (crash-safe purge). */
export const PENDING_PURGE_KEY = 'pendingPurge'
/** meta: time of the last attachment garbage collection (an O(vault) scan, so at most daily). */
export const LAST_ATTACHMENT_GC_KEY = 'lastAttachmentGc'
export const ATTACHMENT_GC_INTERVAL_MS = 24 * 60 * 60 * 1000
/** meta: attachments of permanently deleted notes → time after which the GC may delete them. */
export const ATTACHMENT_DELETE_AFTER_KEY = 'attachmentDeleteAfter'
/** Grace period: another note's undo history may still bring a deleted note's image back. */
export const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000
/** meta: trashed attachments whose metadata is (being) removed but whose blob may not be deleted yet. */
export const PENDING_BLOB_DELETE_KEY = 'pendingBlobDelete'

export interface MaintenanceDeps {
  db: NotesDb
  storage: StorageAdapter
  vault: Vault
  notes: NoteDocCache
  indexer: Indexer
  onError?: (e: StorageError) => void
  now?: () => number
  /** Awaited between notes of O(vault) passes so they never hog the main thread (default: idle callback). */
  pause?: () => Promise<void>
}

const idlePause = () =>
  new Promise<void>((r) =>
    typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 1000 }) : setTimeout(r, 0),
  )

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
  private readonly pause: () => Promise<void>
  private background: Promise<unknown> = Promise.resolve()

  constructor(private readonly d: MaintenanceDeps) {
    this.now = d.now ?? Date.now
    this.pause = d.pause ?? idlePause
  }

  /** Startup pass; run it after the first render (it is O(dirty notes), plus O(vault) at most once a day). */
  async runStartup(): Promise<MaintenanceReport> {
    const { vault, indexer, db } = this.d
    const unreadable = new Set<string>()
    const now = this.now()

    // 1. permanent deletes interrupted last time (normally already done by bootstrap), then old trash.
    // Notes open on screen, or restored while the purge was being recorded, are skipped.
    await this.step(() => this.finishPendingPurges())
    await this.step(async () => {
      const candidates = vault.expiredNoteIds(now).filter((id) => !this.d.notes.isInUse(id))
      if (!candidates.length) return
      await this.addPending(candidates)
      const still = new Set(vault.expiredNoteIds(now).filter((id) => !this.d.notes.isInUse(id)))
      const purge = candidates.filter((id) => still.has(id))
      const kept = candidates.filter((id) => !still.has(id))
      if (kept.length) await this.updatePending((ids) => ids.filter((x) => !kept.includes(x)))
      const skip = new Set(vault.expiredNoteIds(now).filter((id) => !purge.includes(id)))
      vault.purgeExpired(now, undefined, skip)
      await this.finishPurge(purge)
    })

    // 1b. attachment permanent deletes interrupted last time, then attachments the user trashed more
    //     than 30 days ago (deleted even if a note still shows them)
    await this.step(() => this.finishPendingBlobDeletes())
    for (const id of vault.expiredAttachmentIds(now)) await this.purgeAttachment(id)

    // 2. derived index: one rebuild after a version bump (or an empty index), then the dirty-note catch-up
    await this.step(async () => {
      const stored = (await db.meta.get(INDEX_VERSION_KEY))?.value
      if (stored !== INDEX_VERSION || (vault.listNotes().length > 0 && (await db.noteText.count()) === 0)) {
        if (vault.listNotes({ includeTrashed: true }).length > 0) {
          for (const id of (await indexer.rebuildAll({ pause: this.pause })).failed) unreadable.add(id)
        }
        await db.meta.put({ key: INDEX_VERSION_KEY, value: INDEX_VERSION })
      }
    })
    await this.step(async () => {
      for (const id of (await indexer.catchUp({ pause: this.pause })).failed) unreadable.add(id)
    })

    // 3. two tabs may have given notes the same title at the same time
    await this.step(async () => void vault.resolveDuplicateTitles())

    // 4. attachment GC (R8: unreferenced AND older than 30 days), at most once a day; plus attachments of
    //    permanently deleted notes whose grace period is over, if still unreferenced
    await this.step(async () => {
      const marks = await this.deleteMarks()
      const due = Object.entries(marks).filter(([, t]) => t <= now).map(([id]) => id)
      const last = (await db.meta.get(LAST_ATTACHMENT_GC_KEY))?.value
      if (!vault.hasStaleAttachments(now) && !due.length) return
      // The scan is O(vault): at most once a day, also when the last one was aborted by an unreadable note.
      if (typeof last === 'number' && now - last < ATTACHMENT_GC_INTERVAL_MS) return
      await db.meta.put({ key: LAST_ATTACHMENT_GC_KEY, value: now })
      const refs = await indexer.referencedAttachmentIds({ pause: this.pause })
      if (!refs) return // some note is unreadable and may reference any of them: delete nothing
      const ids = new Set(vault.unreferencedAttachmentIds(now, refs))
      const settled = new Set<string>() // due marks that are resolved (deleted, referenced or gone)
      for (const id of due) {
        const a = vault.getAttachment(id)
        // Settled: used again, gone, or restored from the trash after it was marked (the user wants it).
        if (refs.has(id) || !a || (a.restoredAt ?? 0) >= marks[id] - ATTACHMENT_GRACE_MS) settled.add(id)
        else if (a.deletedAt === null) ids.add(id) // one in the trash waits for the trash's own expiry
      }
      for (const id of await this.deleteAttachments([...ids])) if (due.includes(id)) settled.add(id)
      await this.updateMarks((m) => {
        for (const id of settled) delete m[id]
      })
    })

    if (unreadable.size) console.warn(`[maintenance] skipped ${unreadable.size} unreadable note(s)`, [...unreadable])
    return { unreadable: [...unreadable] }
  }

  /**
   * Permanent delete from the trash. Crash-safe: the ids are recorded first, the vault entry goes next
   * (the note disappears at once), then doc and index rows; startup finishes an interrupted run.
   * The note's attachments are not deleted now (another note's undo history may still reference them):
   * they are marked, and the GC deletes them after a grace period if nothing references them then.
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
      if (candidates.size) {
        const after = this.now() + ATTACHMENT_GRACE_MS
        await this.updateMarks((m) => {
          for (const id of candidates) m[id] = Math.max(m[id] ?? 0, after)
        })
      }
      return true
    } catch (e) {
      this.report(e)
      return false
    }
  }

  /**
   * Permanent delete of an attachment from the trash. Metadata first (recorded as pending, so a crash
   * is finished on the next start), then the blob: once this starts, a restore from another tab or the
   * note's 還原 button finds nothing instead of "restoring" an attachment whose file is already gone.
   * Notes that still use it then show a missing file. Refuses attachments that are not in the trash.
   * Never rejects: failures are reported through `onError`; returns whether it was removed.
   */
  async purgeAttachment(id: string): Promise<boolean> {
    const { vault, storage } = this.d
    const trashed = () => vault.getAttachment(id)?.deletedAt != null
    if (!trashed()) return false
    try {
      await this.updatePendingBlobs((ids) => [...new Set([...ids, id])])
      if (!trashed()) {
        await this.updatePendingBlobs((ids) => ids.filter((x) => x !== id)) // restored meanwhile
        return false
      }
      vault.removeAttachment(id)
      await storage.deleteBlob(id)
      await this.updatePendingBlobs((ids) => ids.filter((x) => x !== id))
      return true
    } catch (e) {
      this.report(e)
      return false
    }
  }

  /** Startup: blob deletes left pending by an interrupted purgeAttachment (still-trashed ones finish; restored ones stay). */
  private async finishPendingBlobDeletes(): Promise<void> {
    const { vault, storage } = this.d
    const pending = await this.pendingBlobs()
    if (!pending.length) return
    const done: string[] = []
    for (const id of pending) {
      const a = vault.getAttachment(id)
      if (a && a.deletedAt === null) {
        done.push(id) // restored before its metadata went: keep it
        continue
      }
      if (a) vault.removeAttachment(id)
      await storage.deleteBlob(id)
      done.push(id)
    }
    await this.updatePendingBlobs((ids) => ids.filter((x) => !done.includes(x)))
  }

  private async pendingBlobs(): Promise<string[]> {
    const v = (await this.d.db.meta.get(PENDING_BLOB_DELETE_KEY))?.value
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  private async updatePendingBlobs(fn: (ids: string[]) => string[]): Promise<void> {
    const { db } = this.d
    await db.transaction('rw', db.meta, async () => {
      const after = fn(await this.pendingBlobs())
      if (after.length) await db.meta.put({ key: PENDING_BLOB_DELETE_KEY, value: after })
      else await db.meta.delete(PENDING_BLOB_DELETE_KEY)
    })
  }

  /**
   * Completes permanent deletes interrupted last time. O(pending). Guarded: an id is purged only if its
   * note is gone from the vault, or still trashed and not open; restored ids leave the list, open ones
   * stay pending. With `deferData` (bootstrap, before the UI shows) only the synchronous vault removal
   * happens now and doc/index deletion continues in the background.
   */
  async finishPendingPurges(opts: { deferData?: boolean } = {}): Promise<void> {
    const pending = await this.pendingPurges()
    if (!pending.length) return
    const ids = this.purgeableNow(pending)
    if (opts.deferData) {
      this.removeFromVault(ids)
      this.inBackground(() => this.finishPurge(ids, pending))
    } else await this.finishPurge(ids, pending)
  }

  /** Resolves when background work started by `finishPendingPurges({ deferData })` is done (tests). */
  idle(): Promise<void> {
    return this.background.then(() => undefined)
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

  /** Pending ids that may be purged now: gone from the vault, or still trashed and not open. */
  private purgeableNow(ids: string[]): string[] {
    return ids.filter((id) => {
      const n = this.d.vault.getNote(id)
      return !n || (n.deletedAt !== null && !this.d.notes.isInUse(id))
    })
  }

  private removeFromVault(ids: string[]): void {
    for (const id of ids) if (this.d.vault.getNote(id)) this.d.vault.purgeNote(id) // change never stored
  }

  /**
   * Deletes doc and index data of `noteIds` (after the guard) and updates the pending list: purged and
   * restored ids leave it, ids of trashed notes that are open stay for a later run.
   */
  private async finishPurge(noteIds: string[], considered: string[] = noteIds): Promise<void> {
    const { notes, indexer, vault } = this.d
    const ids = this.purgeableNow(noteIds)
    this.removeFromVault(ids)
    for (const id of ids) {
      await notes.remove(id)
      await indexer.removeNote(id)
    }
    const restored = considered.filter((id) => vault.getNote(id)?.deletedAt === null)
    const done = new Set([...ids, ...restored])
    await this.updatePending((list) => list.filter((x) => !done.has(x)))
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

  private async deleteMarks(): Promise<Record<string, number>> {
    const v = (await this.d.db.meta.get(ATTACHMENT_DELETE_AFTER_KEY))?.value
    return v && typeof v === 'object' ? { ...(v as Record<string, number>) } : {}
  }

  private async updateMarks(fn: (m: Record<string, number>) => void): Promise<void> {
    const { db } = this.d
    await db.transaction('rw', db.meta, async () => {
      const m = await this.deleteMarks()
      fn(m)
      if (Object.keys(m).length) await db.meta.put({ key: ATTACHMENT_DELETE_AFTER_KEY, value: m })
      else await db.meta.delete(ATTACHMENT_DELETE_AFTER_KEY)
    })
  }

  /** Blob first, metadata second: a crash in between leaves metadata the next GC removes, never a lost blob. */
  private async deleteAttachments(ids: string[]): Promise<string[]> {
    const deleted: string[] = []
    for (const id of ids) {
      await this.step(async () => {
        await this.d.storage.deleteBlob(id)
        this.d.vault.removeAttachment(id)
        deleted.push(id)
      })
    }
    return deleted
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
