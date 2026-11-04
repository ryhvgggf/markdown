import * as Y from 'yjs'
import type { StorageAdapter, StorageError } from '@/adapters/storage/types'
import { bindPersistence, type PersistBinding } from '../persist'
import { TAB_ORIGIN, connectTabs } from '../tabs-bridge'
import { newId } from '../ids'
import { orderForIndex } from '../order'
import { dedupeTitle, normalizeTitle } from './titles'
import { VaultError, type AttachmentMeta, type FolderMeta, type NoteMeta } from './types'

export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Origin for vault mutations the user directly asked for (sidebar create/rename/move/trash/restore). Tracked by `undoManager`; maintenance and import writes use no origin and are not undoable. */
export const USER_ACTION: unique symbol = Symbol('user-action')

export interface VaultOpenOptions {
  channelFactory?: (name: string) => BroadcastChannel
  onStorageError?: (e: StorageError) => void
}

type YM = Y.Map<unknown>

function toNote(m: YM): NoteMeta {
  return {
    id: m.get('id') as string,
    title: (m.get('title') as string) ?? '',
    folderId: (m.get('folderId') as string | null) ?? null,
    order: (m.get('order') as string) ?? '',
    createdAt: (m.get('createdAt') as number) ?? 0,
    updatedAt: (m.get('updatedAt') as number) ?? 0,
    deletedAt: (m.get('deletedAt') as number | null) ?? null,
    synced: (m.get('synced') as boolean) ?? false, // absent on notes created before phase 3
    ...stamp(m, 'titleAt'),
    ...stamp(m, 'placeAt'),
    ...stamp(m, 'stateAt'),
    ...stamp(m, 'syncAt'),
  }
}
/** `{ [key]: n }` when the map holds a numeric stamp, else `{}` (absent on records from before 3f-3). */
function stamp<K extends string>(m: YM, key: K): Partial<Record<K, number>> {
  const v = m.get(key)
  return typeof v === 'number' ? ({ [key]: v } as Record<K, number>) : {}
}
/**
 * Switches a note's `synced` flag; when it actually changes, `at` (the user's own switch: now) becomes its
 * `syncAt` stamp. `null` keeps the stamp as it is — for a switch that wasn't this device's choice.
 */
function setSynced(m: YM, synced: boolean, at: number | null = Date.now()): void {
  if (((m.get('synced') as boolean | undefined) ?? false) === synced) return
  m.set('synced', synced)
  if (at !== null) m.set('syncAt', at)
}
function toFolder(m: YM): FolderMeta {
  return {
    id: m.get('id') as string,
    name: (m.get('name') as string) ?? '',
    parentId: (m.get('parentId') as string | null) ?? null,
    order: (m.get('order') as string) ?? '',
    createdAt: (m.get('createdAt') as number) ?? 0,
    deletedAt: (m.get('deletedAt') as number | null) ?? null,
    ...stamp(m, 'nameAt'),
    ...stamp(m, 'placeAt'),
    ...stamp(m, 'stateAt'),
  }
}
function toAttachment(id: string, m: YM): AttachmentMeta {
  return {
    id,
    filename: (m.get('filename') as string) ?? '',
    mimeType: (m.get('mimeType') as string) ?? '',
    size: (m.get('size') as number) ?? 0,
    createdAt: (m.get('createdAt') as number) ?? 0,
    deletedAt: (m.get('deletedAt') as number | null) ?? null, // records from before the attachment trash have none
    ...(typeof m.get('restoredAt') === 'number' ? { restoredAt: m.get('restoredAt') as number } : {}),
  }
}
const isTrashed = (m: YM) => typeof m.get('deletedAt') === 'number'
/** When an attachment last (re)entered use, for the unreferenced GC: upload, or a later restore. */
const inUseSince = (m: YM, now: number) => Math.max((m.get('createdAt') as number) ?? now, (m.get('restoredAt') as number) ?? 0)
function isExpired(m: YM, now: number): boolean {
  const d = m.get('deletedAt') as number | null | undefined
  return typeof d === 'number' && now - d > TRASH_TTL_MS
}
const byOrder = (a: { order: string }, b: { order: string }) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

export class Vault {
  readonly doc: Y.Doc
  private readonly notes: Y.Map<YM>
  private readonly folders: Y.Map<YM>
  private readonly attachments: Y.Map<YM>
  private readonly meta: YM
  private readonly teardown: Array<() => void>
  private readonly binding: PersistBinding
  private readonly undoManager: Y.UndoManager
  /** Fired by `purgeNote`/`purgeFolder` only — a deliberate, permanent delete. Never for `trashNote`/
   * `trashFolder` (reversible), and never inferred from a note simply being absent elsewhere (that could
   * just as easily mean an unrelated bug or local data loss — only this explicit call means "really gone,
   * on purpose"). `core/sync-engine` uses this as the one safe signal to also delete a note's cloud copy. */
  private readonly notePurgedHandlers = new Set<(id: string) => void>()

  private constructor(
    private readonly id: string,
    doc: Y.Doc,
    binding: PersistBinding,
    teardown: Array<() => void>,
  ) {
    this.doc = doc
    this.binding = binding
    this.teardown = teardown
    this.meta = doc.getMap('meta')
    this.notes = doc.getMap('notes')
    this.folders = doc.getMap('folders')
    this.attachments = doc.getMap('attachments')
    // captureTimeout 0: each call below is one discrete user action, never merged with the next.
    this.undoManager = new Y.UndoManager([this.notes, this.folders], { trackedOrigins: new Set([USER_ACTION]), captureTimeout: 0 })
  }

  static async open(storage: StorageAdapter, vaultId: string, opts: VaultOpenOptions = {}): Promise<Vault> {
    const doc = new Y.Doc()
    const teardown: Array<() => void> = []
    const binding = await bindPersistence(doc, vaultId, storage, {
      ignoreOrigins: [TAB_ORIGIN],
      onError: opts.onStorageError,
    })
    teardown.push(() => binding.destroy())
    if (opts.channelFactory || typeof BroadcastChannel !== 'undefined') {
      teardown.push(connectTabs(doc, vaultId, opts.channelFactory))
    }
    const vault = new Vault(vaultId, doc, binding, teardown)
    if (!vault.meta.has('schemaVersion')) {
      doc.transact(() => {
        vault.meta.set('schemaVersion', 1)
        vault.meta.set('name', vaultId)
        vault.meta.set('createdAt', Date.now())
      })
    }
    return vault
  }

  // ---- queries ----
  listNotes(o: { includeTrashed?: boolean } = {}): NoteMeta[] {
    const all = [...this.notes.values()].map(toNote)
    return o.includeTrashed ? all : all.filter((n) => n.deletedAt === null)
  }
  getNote(id: string): NoteMeta | undefined {
    const m = this.notes.get(id)
    return m ? toNote(m) : undefined
  }
  listFolders(o: { includeTrashed?: boolean } = {}): FolderMeta[] {
    const all = [...this.folders.values()].map(toFolder)
    return o.includeTrashed ? all : all.filter((f) => f.deletedAt === null)
  }
  isTitleAvailable(title: string, exceptId?: string): boolean {
    const t = normalizeTitle(title)
    if (t === '') return true
    return !this.listNotes().some((n) => n.id !== exceptId && normalizeTitle(n.title) === t)
  }

  // ---- notes ----
  /** `id`, `createdAt`, `updatedAt`: only for import or cloud-manifest merge (an id already in use → VaultError 'exists'). */
  createNote(
    i: { id?: string; title?: string; folderId?: string | null; index?: number; createdAt?: number; updatedAt?: number } = {},
  ): NoteMeta {
    const title = (i.title ?? '').trim()
    const folderId = i.folderId ?? null
    if (folderId !== null) this.folder(folderId)
    if (!this.isTitleAvailable(title)) throw new VaultError('duplicate-title')
    if (i.id && this.notes.has(i.id)) throw new VaultError('exists')
    const id = i.id ?? newId()
    const now = Date.now()
    const order = this.noteOrder(folderId, i.index ?? Number.MAX_SAFE_INTEGER)
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.notes.set(id, m)
      m.set('id', id)
      m.set('title', title)
      m.set('folderId', folderId)
      m.set('order', order)
      m.set('createdAt', i.createdAt ?? now)
      m.set('updatedAt', i.updatedAt ?? i.createdAt ?? now)
      m.set('deletedAt', null)
      m.set('synced', false) // opt-in, one note at a time (a folder never decides)
    })
    return this.getNote(id)!
  }
  renameNote(id: string, title: string): void {
    const m = this.note(id)
    const t = title.trim()
    if (!this.isTitleAvailable(t, id)) throw new VaultError('duplicate-title')
    const now = Date.now()
    this.doc.transact(() => {
      m.set('title', t)
      m.set('updatedAt', now)
      m.set('titleAt', now)
    })
  }
  moveNote(id: string, to: { folderId: string | null; index: number }): void {
    const m = this.note(id)
    if (to.folderId !== null) this.folder(to.folderId)
    const order = this.noteOrder(to.folderId, to.index, id)
    this.doc.transact(() => {
      m.set('folderId', to.folderId)
      m.set('order', order)
      m.set('placeAt', Date.now())
    })
  }
  /**
   * Applies a title/placement another device set (cloud manifest merge, 3f-3), keeping that device's
   * timestamps so last-writer-wins compares the same values everywhere. Each part is applied only when
   * possible: a title taken by another local note gets a ` (n)` suffix locally (the remote title still
   * wins in the cloud, see `combineManifests`); a placement whose folder is missing or trashed here is skipped.
   * Not a user action (not undoable); `updatedAt` is left alone.
   */
  applyRemoteNote(id: string, p: { title?: string; titleAt?: number; folderId?: string | null; order?: string; placeAt?: number; updatedAt?: number }): void {
    const m = this.note(id)
    let title: string | undefined
    if (p.title !== undefined) {
      const t = p.title.trim()
      title = this.isTitleAvailable(t, id) ? t : dedupeTitle(t, new Set(this.listNotes().filter((n) => n.id !== id).map((n) => n.title)))
    }
    const placeOk = p.folderId === undefined || p.folderId === null || this.folders.get(p.folderId)?.get('deletedAt') === null
    this.doc.transact(() => {
      if (p.updatedAt !== undefined && p.updatedAt > ((m.get('updatedAt') as number) ?? 0)) m.set('updatedAt', p.updatedAt) // "last modified" follows the newest edit anywhere
      if (title !== undefined) m.set('title', title)
      if (p.titleAt !== undefined) m.set('titleAt', p.titleAt)
      if (!placeOk) return
      if (p.folderId !== undefined) m.set('folderId', p.folderId)
      if (p.order !== undefined) m.set('order', p.order)
      if (p.placeAt !== undefined) m.set('placeAt', p.placeAt)
    })
  }
  touchNote(id: string): void {
    const m = this.note(id)
    this.doc.transact(() => m.set('updatedAt', Date.now()))
  }
  /** Phase 3 design doc §8.5: turn cloud sync on/off for one note. Pure local flag — pushing the initial
   * snapshot, deleting the cloud copy, and recomputing the cloud manifest are `core/sync-engine`'s job
   * (it observes this field), not the vault's. */
  setNoteSynced(id: string, synced: boolean, opts: { at?: number | null } = {}): void {
    const m = this.note(id)
    this.doc.transact(() => setSynced(m, synced, opts.at === undefined ? Date.now() : opts.at))
  }
  trashNote(id: string): void {
    const m = this.note(id)
    const now = Date.now()
    this.doc.transact(() => {
      m.set('deletedAt', now)
      m.set('stateAt', now)
    })
  }
  /**
   * Applies a trash state another device set (cloud manifest merge): moved to the trash with that device's time
   * (so the 30 days run from the same moment everywhere), or taken out of it like a restore (a taken title gets a
   * suffix, a missing folder means the top level). The stamp is the other device's, for last-writer-wins.
   */
  applyRemoteNoteState(id: string, s: { deletedAt: number | null; stateAt: number }): void {
    const m = this.note(id)
    this.doc.transact(() => {
      if (s.deletedAt === null) this.restoreNoteIn(m)
      else m.set('deletedAt', s.deletedAt)
      m.set('stateAt', s.stateAt)
    })
  }
  /** Folder counterpart of `applyRemoteNoteState`; restoring under a trashed parent puts it at the top level. */
  applyRemoteFolderState(id: string, s: { deletedAt: number | null; stateAt: number }): void {
    const m = this.folder(id)
    this.doc.transact(() => {
      if (s.deletedAt === null) {
        const parent = m.get('parentId') as string | null
        if (parent !== null && this.folders.get(parent)?.get('deletedAt') !== null) m.set('parentId', null)
      }
      m.set('deletedAt', s.deletedAt)
      m.set('stateAt', s.stateAt)
    })
  }
  restoreNote(id: string): void {
    const m = this.note(id)
    this.doc.transact(() => this.restoreNoteIn(m))
  }
  purgeNote(id: string): void {
    this.note(id)
    this.doc.transact(() => this.notes.delete(id))
    for (const h of this.notePurgedHandlers) h(id)
  }
  /** Subscribes to permanent note deletes (see `notePurgedHandlers`'s own comment). */
  onNotePurged(cb: (id: string) => void): () => void {
    this.notePurgedHandlers.add(cb)
    return () => this.notePurgedHandlers.delete(cb)
  }

  // ---- folders ----
  /** `id`, `createdAt`: only for import or cloud-manifest merge (an id already in use → VaultError 'exists'). */
  createFolder(i: { id?: string; name: string; parentId: string | null; index?: number; createdAt?: number }): FolderMeta {
    if (i.parentId !== null) this.folder(i.parentId)
    if (i.id && this.folders.has(i.id)) throw new VaultError('exists')
    const id = i.id ?? newId()
    const order = this.folderOrder(i.parentId, i.index ?? Number.MAX_SAFE_INTEGER)
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.folders.set(id, m)
      m.set('id', id)
      m.set('name', i.name.trim())
      m.set('parentId', i.parentId)
      m.set('order', order)
      m.set('createdAt', i.createdAt ?? Date.now())
      m.set('deletedAt', null)
    })
    return toFolder(this.folders.get(id)!)
  }
  renameFolder(id: string, name: string): void {
    const m = this.folder(id)
    this.doc.transact(() => {
      m.set('name', name.trim())
      m.set('nameAt', Date.now())
    })
  }
  moveFolder(id: string, to: { parentId: string | null; index: number }): void {
    const m = this.folder(id)
    if (to.parentId !== null) {
      this.folder(to.parentId)
      for (let p: string | null = to.parentId, guard = 0; p !== null && guard < 10000; guard++) {
        if (p === id) throw new VaultError('cycle')
        p = (this.folders.get(p)?.get('parentId') as string | null) ?? null
      }
    }
    const order = this.folderOrder(to.parentId, to.index, id)
    this.doc.transact(() => {
      m.set('parentId', to.parentId)
      m.set('order', order)
      m.set('placeAt', Date.now())
    })
  }
  /** Folder counterpart of `applyRemoteNote`. A placement under a missing/trashed parent, or one that would make a cycle, is skipped. */
  applyRemoteFolder(id: string, p: { name?: string; nameAt?: number; parentId?: string | null; order?: string; placeAt?: number }): void {
    const m = this.folder(id)
    let placeOk = true
    if (p.parentId !== undefined && p.parentId !== null) {
      placeOk = this.folders.get(p.parentId)?.get('deletedAt') === null
      for (let q: string | null = p.parentId, guard = 0; placeOk && q !== null && guard < 10000; guard++) {
        if (q === id) placeOk = false
        q = (this.folders.get(q)?.get('parentId') as string | null) ?? null
      }
    }
    this.doc.transact(() => {
      if (p.name !== undefined) m.set('name', p.name.trim())
      if (p.nameAt !== undefined) m.set('nameAt', p.nameAt)
      if (!placeOk) return
      if (p.parentId !== undefined) m.set('parentId', p.parentId)
      if (p.order !== undefined) m.set('order', p.order)
      if (p.placeAt !== undefined) m.set('placeAt', p.placeAt)
    })
  }
  trashFolder(id: string): void {
    this.folder(id)
    const ids = this.subtreeIds(id)
    const now = Date.now()
    this.doc.transact(() => {
      for (const fid of ids) {
        this.folders.get(fid)?.set('deletedAt', now)
        this.folders.get(fid)?.set('stateAt', now)
      }
      for (const n of this.notes.values()) {
        const f = n.get('folderId') as string | null
        if (f !== null && ids.has(f)) {
          n.set('deletedAt', now)
          n.set('stateAt', now)
        }
      }
    })
  }
  restoreFolder(id: string): void {
    const root = this.folder(id)
    const ids = this.subtreeIds(id)
    this.doc.transact(() => {
      const parent = root.get('parentId') as string | null
      if (parent !== null && this.folders.get(parent)?.get('deletedAt') !== null) root.set('parentId', null)
      const now = Date.now()
      for (const fid of ids) {
        this.folders.get(fid)?.set('deletedAt', null)
        this.folders.get(fid)?.set('stateAt', now)
      }
      for (const n of this.notes.values()) {
        const f = n.get('folderId') as string | null
        if (f !== null && ids.has(f) && n.get('deletedAt') !== null) this.restoreNoteIn(n)
      }
    })
  }

  /** Ids of every note inside a folder subtree (trashed included). */
  folderNoteIds(id: string): string[] {
    this.folder(id)
    const ids = this.subtreeIds(id)
    return [...this.notes.entries()].filter(([, m]) => ids.has((m.get('folderId') as string | null) ?? '')).map(([k]) => k)
  }

  /** Permanently removes a folder subtree and every note inside it; returns the purged note ids. */
  purgeFolder(id: string): string[] {
    const noteIds = this.folderNoteIds(id)
    const ids = this.subtreeIds(id)
    this.doc.transact(() => {
      noteIds.forEach((k) => this.notes.delete(k))
      ids.forEach((k) => this.folders.delete(k))
    })
    for (const noteId of noteIds) for (const h of this.notePurgedHandlers) h(noteId)
    return noteIds
  }

  // ---- maintenance ----
  /** True when some live attachment is old enough to be purged if unreferenced (cheap pre-check for startup). */
  hasStaleAttachments(now: number): boolean {
    for (const m of this.attachments.values()) if (!isTrashed(m) && now - inUseSince(m, now) > TRASH_TTL_MS) return true
    return false
  }
  /** Ids of notes trashed more than 30 days ago (what `purgeExpired(now)` would remove). */
  expiredNoteIds(now: number): string[] {
    return [...this.notes.entries()].filter(([, m]) => isExpired(m, now)).map(([k]) => k)
  }
  /** Ids of attachments the user trashed more than 30 days ago (deleted whether or not a note uses them). */
  expiredAttachmentIds(now: number): string[] {
    return [...this.attachments.entries()].filter(([, m]) => isExpired(m, now)).map(([k]) => k)
  }
  /**
   * Attachments that may be purged (R8): live (not in the trash, which has its own expiry), older than
   * 30 days AND absent from `referencedAttachmentIds`, which must include references from
   * trashed-but-unexpired notes too.
   */
  unreferencedAttachmentIds(now: number, referencedAttachmentIds: Set<string>): string[] {
    return [...this.attachments.entries()]
      .filter(
        ([k, m]) => !isTrashed(m) && !referencedAttachmentIds.has(k) && now - inUseSince(m, now) > TRASH_TTL_MS,
      )
      .map(([k]) => k)
  }
  /**
   * Removes notes/folders trashed more than 30 days ago. Attachments are returned and removed only if
   * they are older than 30 days AND absent from `referencedAttachmentIds`; that set must include
   * references from trashed-but-unexpired notes too. Omitted set: no attachments are touched.
   */
  purgeExpired(
    now: number,
    referencedAttachmentIds?: Set<string>,
    /** Expired notes to keep for now (e.g. open on screen); their folders are kept too. */
    skip: Set<string> = new Set(),
  ): { noteIds: string[]; attachmentIds: string[] } {
    const noteIds = this.expiredNoteIds(now).filter((id) => !skip.has(id))
    const keepFolders = new Set<string>()
    for (const id of skip) {
      let f = (this.notes.get(id)?.get('folderId') as string | null) ?? null
      for (let guard = 0; f !== null && !keepFolders.has(f) && guard < 10000; guard++) {
        keepFolders.add(f)
        f = (this.folders.get(f)?.get('parentId') as string | null) ?? null
      }
    }
    const folderIds = [...this.folders.entries()]
      .filter(([k, m]) => isExpired(m, now) && !keepFolders.has(k))
      .map(([k]) => k)
    const attachmentIds = referencedAttachmentIds ? this.unreferencedAttachmentIds(now, referencedAttachmentIds) : []
    this.doc.transact(() => {
      noteIds.forEach((k) => this.notes.delete(k))
      folderIds.forEach((k) => this.folders.delete(k))
      attachmentIds.forEach((k) => this.attachments.delete(k))
    })
    // A permanent delete, same as purgeNote/purgeFolder — this is in fact how most users' "delete" actually
    // resolves (trash, then age out), so core/sync-engine needs this signal here too, not just from the
    // explicit "delete forever" buttons.
    for (const noteId of noteIds) for (const h of this.notePurgedHandlers) h(noteId)
    return { noteIds, attachmentIds }
  }
  addAttachment(a: Omit<AttachmentMeta, 'id' | 'createdAt' | 'deletedAt'> & { id?: string; createdAt?: number }): AttachmentMeta {
    if (a.id && this.attachments.has(a.id)) throw new VaultError('exists')
    const meta: AttachmentMeta = { ...a, id: a.id ?? newId(), createdAt: a.createdAt ?? Date.now(), deletedAt: null }
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.attachments.set(meta.id, m)
      for (const [k, v] of Object.entries(meta)) m.set(k, v)
    })
    return meta
  }
  getAttachment(id: string): AttachmentMeta | undefined {
    const m = this.attachments.get(id)
    return m ? toAttachment(id, m) : undefined
  }
  listAttachments(o: { includeTrashed?: boolean } = {}): AttachmentMeta[] {
    const all = [...this.attachments.entries()].map(([id, m]) => toAttachment(id, m))
    return o.includeTrashed ? all : all.filter((a) => a.deletedAt === null)
  }
  /** Moves an attachment to the trash; notes that use it show it as trashed until it is restored. */
  trashAttachment(id: string): void {
    const m = this.attachment(id)
    this.doc.transact(() => m.set('deletedAt', Date.now()))
  }
  /**
   * Takes an attachment out of the trash. Stamps `restoredAt`: the unreferenced GC counts age from it,
   * so a restored file gets a fresh 30 days instead of vanishing at the next daily run.
   */
  restoreAttachment(id: string): void {
    const m = this.attachment(id)
    this.doc.transact(() => {
      m.set('deletedAt', null)
      m.set('restoredAt', Date.now())
    })
  }
  /** Drops attachment metadata only (the blob is the caller's concern). */
  removeAttachment(id: string): void {
    this.attachments.delete(id)
  }
  resolveDuplicateTitles(): string[] {
    const live = this.listNotes()
      .filter((n) => normalizeTitle(n.title) !== '')
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    const seen = new Set<string>()
    const renamed: string[] = []
    const taken = new Set(live.map((n) => n.title))
    this.doc.transact(() => {
      for (const n of live) {
        if (!seen.has(normalizeTitle(n.title))) {
          seen.add(normalizeTitle(n.title))
          continue
        }
        const t = dedupeTitle(n.title, new Set([...taken, ...seen]))
        taken.add(t)
        seen.add(normalizeTitle(t))
        this.notes.get(n.id)?.set('title', t)
        renamed.push(n.id)
      }
    })
    return renamed
  }

  /** Persistence state of the vault doc itself (see PersistBinding). */
  hasPendingWrites(): boolean {
    return this.binding.hasPending()
  }
  hasFailedWrites(): boolean {
    return this.binding.isFailing()
  }
  /** Hands the vault's not-yet-stored updates to `stash` (synchronous; used on pagehide). */
  stashUnsaved(stash: (docId: string, update: Uint8Array) => void): void {
    const u = this.binding.pendingUpdate()
    if (u) stash(this.id, u)
  }
  retryWrites(): void {
    this.binding.retry()
  }
  flushWrites(): Promise<void> {
    return this.binding.flush()
  }

  observe(cb: () => void): () => void {
    const maps = [this.meta, this.notes, this.folders, this.attachments]
    const h = () => cb()
    maps.forEach((m) => m.observeDeep(h))
    return () => maps.forEach((m) => m.unobserveDeep(h))
  }

  // ---- undo (notes & folders only; see USER_ACTION) ----
  /** Runs `fn` as one undoable step. Calls it makes to Vault mutators join the undo stack as a single step. */
  asUserAction<T>(fn: () => T): T {
    return this.doc.transact(fn, USER_ACTION)
  }
  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0
  }
  undo(): void {
    this.undoManager.undo()
  }
  redo(): void {
    this.undoManager.redo()
  }
  /** Fires after every undo-stack change (push, undo, redo, or `stopCapturing`-separated step). */
  onUndoChange(cb: () => void): () => void {
    const h = () => cb()
    this.undoManager.on('stack-item-added', h)
    this.undoManager.on('stack-item-popped', h)
    return () => {
      this.undoManager.off('stack-item-added', h)
      this.undoManager.off('stack-item-popped', h)
    }
  }

  close(): void {
    this.undoManager.destroy()
    this.teardown.reverse().forEach((t) => t())
    this.teardown.length = 0
  }

  // ---- internals ----
  private note(id: string): YM {
    const m = this.notes.get(id)
    if (!m) throw new VaultError('not-found', `note ${id}`)
    return m
  }
  private attachment(id: string): YM {
    const m = this.attachments.get(id)
    if (!m) throw new VaultError('not-found', `attachment ${id}`)
    return m
  }
  private folder(id: string): YM {
    const m = this.folders.get(id)
    if (!m) throw new VaultError('not-found', `folder ${id}`)
    return m
  }
  private restoreNoteIn(m: YM): void {
    const id = m.get('id') as string
    const f = m.get('folderId') as string | null
    if (f !== null && this.folders.get(f)?.get('deletedAt') !== null) m.set('folderId', null)
    const title = (m.get('title') as string) ?? ''
    if (!this.isTitleAvailable(title, id)) {
      const taken = new Set(this.listNotes().filter((n) => n.id !== id).map((n) => n.title))
      m.set('title', dedupeTitle(title, taken))
    }
    m.set('deletedAt', null)
    m.set('stateAt', Date.now())
  }
  private subtreeIds(rootId: string): Set<string> {
    const ids = new Set([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const f of this.folders.values()) {
        const p = f.get('parentId') as string | null
        const fid = f.get('id') as string
        if (p !== null && ids.has(p) && !ids.has(fid)) {
          ids.add(fid)
          grew = true
        }
      }
    }
    return ids
  }
  private noteOrder(folderId: string | null, index: number, exceptId?: string): string {
    const sib = this.listNotes().filter((n) => n.folderId === folderId && n.id !== exceptId)
    return orderForIndex(sib.sort(byOrder).map((n) => n.order), index)
  }
  private folderOrder(parentId: string | null, index: number, exceptId?: string): string {
    const sib = this.listFolders().filter((f) => f.parentId === parentId && f.id !== exceptId)
    return orderForIndex(sib.sort(byOrder).map((f) => f.order), index)
  }
}
