import * as Y from 'yjs'
import { StorageError, type StorageAdapter } from '@/adapters/storage/types'
import { bindPersistence, PERSIST_ORIGIN, type PersistBinding } from '../persist'
import { TAB_ORIGIN, connectTabs } from '../tabs-bridge'

export class NoteDocError extends Error {
  code: 'corrupted'
  constructor(code: 'corrupted', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NoteDocError'
    this.code = code
  }
}

export interface NoteDocCacheOptions {
  max?: number
  onStorageError?: (e: StorageError) => void
  channelFactory?: (name: string) => BroadcastChannel
}

const INIT_ORIGIN = Symbol('note-doc-init')

interface Entry {
  doc: Y.Doc
  refs: number
  binding: PersistBinding
  teardown: Array<() => void>
}

export class NoteDocCache {
  private readonly max: number
  private readonly loaded = new Map<string, Entry>() // insertion order = LRU order (oldest first)
  private readonly loading = new Map<string, Promise<Entry>>()
  private readonly listeners = new Set<(noteId: string, doc: Y.Doc) => void>()

  constructor(
    private readonly storage: StorageAdapter,
    private readonly opts: NoteDocCacheOptions = {},
  ) {
    this.max = opts.max ?? 20
  }

  async acquire(noteId: string): Promise<Y.Doc> {
    let entry = this.loaded.get(noteId)
    if (!entry) {
      let p = this.loading.get(noteId)
      if (!p) {
        p = this.load(noteId).finally(() => this.loading.delete(noteId))
        this.loading.set(noteId, p)
      }
      entry = await p
    }
    entry.refs++
    this.touch(noteId, entry)
    this.evict()
    return entry.doc
  }

  release(noteId: string): void {
    const entry = this.loaded.get(noteId)
    if (!entry || entry.refs === 0) return
    entry.refs--
    this.evict()
  }

  peek(noteId: string): Y.Doc | undefined {
    return this.loaded.get(noteId)?.doc
  }

  /** Deletes a note's doc for good: stops writing, waits for the write in flight, then deletes stored data. */
  async remove(noteId: string): Promise<void> {
    await this.loading.get(noteId)?.catch(() => undefined)
    const entry = this.loaded.get(noteId)
    if (entry) {
      this.loaded.delete(noteId)
      for (const t of entry.teardown) t()
      await entry.binding.close()
      entry.doc.destroy()
    }
    await this.storage.deleteDoc(noteId)
  }

  /** True while some loaded doc has local updates that are not stored yet (queued or awaiting a retry). */
  hasUnsaved(): boolean {
    for (const e of this.loaded.values()) if (e.binding.hasPending()) return true
    return false
  }

  /** Hands every doc's not-yet-stored updates to `stash` (synchronous; used on pagehide). */
  stashUnsaved(stash: (docId: string, update: Uint8Array) => void): void {
    for (const [id, e] of this.loaded) {
      const u = e.binding.pendingUpdate()
      if (u) stash(id, u)
    }
  }

  /** True while some loaded doc's last write failed (a retry is scheduled). */
  hasFailedWrites(): boolean {
    for (const e of this.loaded.values()) if (e.binding.isFailing()) return true
    return false
  }

  /** Waits for every queued write (one attempt each; failures stay queued for retry). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.loaded.values()].map((e) => e.binding.flush()))
  }

  /** Retries failed writes now (e.g. when the page becomes visible again or the device goes online). */
  retryAll(): void {
    for (const e of this.loaded.values()) e.binding.retry()
  }

  onChange(cb: (noteId: string, doc: Y.Doc) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private async load(noteId: string): Promise<Entry> {
    const doc = new Y.Doc()
    const teardown: Array<() => void> = []
    let binding: PersistBinding
    try {
      binding = await bindPersistence(doc, noteId, this.storage, {
        ignoreOrigins: [TAB_ORIGIN],
        onError: this.opts.onStorageError,
      })
      teardown.push(() => binding.destroy())
    } catch (e) {
      doc.destroy()
      // Storage failures propagate as-is; anything else came from applying stored bytes.
      if (e instanceof StorageError) throw e
      throw new NoteDocError('corrupted', `Stored data for note ${noteId} is corrupted`, { cause: e })
    }
    if (this.opts.channelFactory || typeof BroadcastChannel !== 'undefined') {
      teardown.push(connectTabs(doc, noteId, this.opts.channelFactory))
    }
    const meta = doc.getMap('meta')
    if (!meta.has('schemaVersion')) doc.transact(() => meta.set('schemaVersion', 1), INIT_ORIGIN)
    doc.getXmlFragment('content')
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === PERSIST_ORIGIN || origin === INIT_ORIGIN) return
      for (const cb of [...this.listeners]) cb(noteId, doc)
    }
    doc.on('update', onUpdate)
    teardown.push(() => doc.off('update', onUpdate))
    const entry: Entry = { doc, refs: 0, binding, teardown }
    this.loaded.set(noteId, entry)
    return entry
  }

  private touch(noteId: string, entry: Entry): void {
    this.loaded.delete(noteId)
    this.loaded.set(noteId, entry)
  }

  private evict(): void {
    for (const [id, entry] of this.loaded) {
      if (this.loaded.size <= this.max) return
      // A doc with unsaved updates stays loaded (its writes keep retrying) so nothing typed is dropped.
      if (entry.refs === 0 && !entry.binding.hasPending()) this.dispose(id, entry)
    }
  }

  private dispose(noteId: string, entry: Entry): void {
    this.loaded.delete(noteId)
    for (const t of entry.teardown) t()
    entry.doc.destroy()
  }
}
