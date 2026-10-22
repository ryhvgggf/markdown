import * as Y from 'yjs'
import type { StorageAdapter, StorageError } from '@/adapters/storage/types'
import { bindPersistence, type PersistBinding } from '../persist'
import { TAB_ORIGIN, connectTabs } from '../tabs-bridge'
import { newId } from '../ids'
import { orderForIndex } from '../order'
import { dedupeTitle, normalizeTitle } from './titles'
import { VaultError, type AttachmentMeta, type FolderMeta, type NoteMeta } from './types'

export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

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
  }
}
function toFolder(m: YM): FolderMeta {
  return {
    id: m.get('id') as string,
    name: (m.get('name') as string) ?? '',
    parentId: (m.get('parentId') as string | null) ?? null,
    order: (m.get('order') as string) ?? '',
    createdAt: (m.get('createdAt') as number) ?? 0,
    deletedAt: (m.get('deletedAt') as number | null) ?? null,
  }
}
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
  createNote(i: { title?: string; folderId?: string | null; index?: number } = {}): NoteMeta {
    const title = (i.title ?? '').trim()
    const folderId = i.folderId ?? null
    if (folderId !== null) this.folder(folderId)
    if (!this.isTitleAvailable(title)) throw new VaultError('duplicate-title')
    const id = newId()
    const now = Date.now()
    const order = this.noteOrder(folderId, i.index ?? Number.MAX_SAFE_INTEGER)
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.notes.set(id, m)
      m.set('id', id)
      m.set('title', title)
      m.set('folderId', folderId)
      m.set('order', order)
      m.set('createdAt', now)
      m.set('updatedAt', now)
      m.set('deletedAt', null)
    })
    return this.getNote(id)!
  }
  renameNote(id: string, title: string): void {
    const m = this.note(id)
    const t = title.trim()
    if (!this.isTitleAvailable(t, id)) throw new VaultError('duplicate-title')
    this.doc.transact(() => {
      m.set('title', t)
      m.set('updatedAt', Date.now())
    })
  }
  moveNote(id: string, to: { folderId: string | null; index: number }): void {
    const m = this.note(id)
    if (to.folderId !== null) this.folder(to.folderId)
    const order = this.noteOrder(to.folderId, to.index, id)
    this.doc.transact(() => {
      m.set('folderId', to.folderId)
      m.set('order', order)
    })
  }
  touchNote(id: string): void {
    const m = this.note(id)
    this.doc.transact(() => m.set('updatedAt', Date.now()))
  }
  trashNote(id: string): void {
    const m = this.note(id)
    this.doc.transact(() => m.set('deletedAt', Date.now()))
  }
  restoreNote(id: string): void {
    const m = this.note(id)
    this.doc.transact(() => this.restoreNoteIn(m))
  }
  purgeNote(id: string): void {
    this.note(id)
    this.doc.transact(() => this.notes.delete(id))
  }

  // ---- folders ----
  createFolder(i: { name: string; parentId: string | null; index?: number }): FolderMeta {
    if (i.parentId !== null) this.folder(i.parentId)
    const id = newId()
    const order = this.folderOrder(i.parentId, i.index ?? Number.MAX_SAFE_INTEGER)
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.folders.set(id, m)
      m.set('id', id)
      m.set('name', i.name.trim())
      m.set('parentId', i.parentId)
      m.set('order', order)
      m.set('createdAt', Date.now())
      m.set('deletedAt', null)
    })
    return toFolder(this.folders.get(id)!)
  }
  renameFolder(id: string, name: string): void {
    const m = this.folder(id)
    this.doc.transact(() => m.set('name', name.trim()))
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
    })
  }
  trashFolder(id: string): void {
    this.folder(id)
    const ids = this.subtreeIds(id)
    const now = Date.now()
    this.doc.transact(() => {
      for (const fid of ids) this.folders.get(fid)?.set('deletedAt', now)
      for (const n of this.notes.values()) {
        const f = n.get('folderId') as string | null
        if (f !== null && ids.has(f)) n.set('deletedAt', now)
      }
    })
  }
  restoreFolder(id: string): void {
    const root = this.folder(id)
    const ids = this.subtreeIds(id)
    this.doc.transact(() => {
      const parent = root.get('parentId') as string | null
      if (parent !== null && this.folders.get(parent)?.get('deletedAt') !== null) root.set('parentId', null)
      for (const fid of ids) this.folders.get(fid)?.set('deletedAt', null)
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
    return noteIds
  }

  // ---- maintenance ----
  /** True when some attachment is old enough to be purged if unreferenced (cheap pre-check for startup). */
  hasStaleAttachments(now: number): boolean {
    for (const m of this.attachments.values()) if (now - ((m.get('createdAt') as number) ?? now) > TRASH_TTL_MS) return true
    return false
  }
  /** Ids of notes trashed more than 30 days ago (what `purgeExpired(now)` would remove). */
  expiredNoteIds(now: number): string[] {
    return [...this.notes.entries()].filter(([, m]) => isExpired(m, now)).map(([k]) => k)
  }
  /**
   * Attachments that may be purged (R8): older than 30 days AND absent from `referencedAttachmentIds`,
   * which must include references from trashed-but-unexpired notes too.
   */
  unreferencedAttachmentIds(now: number, referencedAttachmentIds: Set<string>): string[] {
    return [...this.attachments.entries()]
      .filter(([k, m]) => !referencedAttachmentIds.has(k) && now - ((m.get('createdAt') as number) ?? now) > TRASH_TTL_MS)
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
    return { noteIds, attachmentIds }
  }
  addAttachment(a: Omit<AttachmentMeta, 'id' | 'createdAt'>): AttachmentMeta {
    const meta: AttachmentMeta = { ...a, id: newId(), createdAt: Date.now() }
    this.doc.transact(() => {
      const m: YM = new Y.Map()
      this.attachments.set(meta.id, m)
      for (const [k, v] of Object.entries(meta)) m.set(k, v)
    })
    return meta
  }
  getAttachment(id: string): AttachmentMeta | undefined {
    const m = this.attachments.get(id)
    return m ? ({ id, ...Object.fromEntries(m.entries()) } as AttachmentMeta) : undefined
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
  close(): void {
    this.teardown.reverse().forEach((t) => t())
    this.teardown.length = 0
  }

  // ---- internals ----
  private note(id: string): YM {
    const m = this.notes.get(id)
    if (!m) throw new VaultError('not-found', `note ${id}`)
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
