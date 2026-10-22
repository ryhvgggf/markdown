import * as Y from 'yjs'
import { StorageError, type StorageAdapter } from '@/adapters/storage/types'

export const PERSIST_ORIGIN: unique symbol = Symbol('persist')

export interface PersistOptions {
  compactAfter?: number
  ignoreOrigins?: unknown[]
  onError?: (e: StorageError) => void
}

export interface PersistBinding {
  /** Stops listening for new updates; already queued updates are still written (and retried). */
  destroy(): void
  /** Resolves once every queued update has been written, or the current attempt failed. */
  flush(): Promise<void>
  /** True while some local update is not yet stored (queued, in flight, or waiting for a retry). */
  hasPending(): boolean
  /** All local updates not yet stored, merged into one (null when none); for a synchronous unload stash. */
  pendingUpdate(): Uint8Array | null
  /** True when the last write failed and a retry is scheduled. */
  isFailing(): boolean
  /** Retries a failed write now instead of waiting for the backoff timer. */
  retry(): void
  /** Stops for good: detaches, cancels retries, drops unsent updates and waits for the in-flight write. */
  close(): Promise<void>
}

/** Delay before the n-th consecutive retry after a failed write. */
export const RETRY_BACKOFF_MS = [2000, 5000, 15000, 30000, 60000]

export async function bindPersistence(
  doc: Y.Doc,
  docId: string,
  storage: StorageAdapter,
  opts: PersistOptions = {},
): Promise<PersistBinding> {
  const compactAfter = opts.compactAfter ?? 200
  const ignore = new Set<unknown>([PERSIST_ORIGIN, ...(opts.ignoreOrigins ?? [])])

  const stored = await storage.loadDoc(docId)
  doc.transact(() => {
    for (const u of stored) Y.applyUpdate(doc, u, PERSIST_ORIGIN)
  }, PERSIST_ORIGIN)

  let count = stored.length
  const pending: Uint8Array[] = []
  let chain: Promise<void> = Promise.resolve()
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const scheduleRetry = () => {
    if (closed || retryTimer !== null) return
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length - 1)]
    failures++
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flush()
    }, delay)
  }

  const drain = async () => {
    try {
      while (pending.length > 0 && !closed) {
        // Everything queued so far goes into ONE transaction (updates typed while a write is in flight
        // are coalesced), so a burst of keystrokes costs one IndexedDB round trip, not one per key.
        const n = pending.length
        const batch = n === 1 ? pending[0] : Y.mergeUpdates(pending.slice(0, n))
        count = await storage.appendUpdate(docId, batch)
        pending.splice(0, n)
        if (count >= compactAfter && !closed) {
          await storage.compact(docId, Y.encodeStateAsUpdate(doc))
          count = 0
        }
      }
      failures = 0
    } catch (e) {
      opts.onError?.(e instanceof StorageError ? e : new StorageError('unknown', String(e), { cause: e }))
      if (pending.length > 0) scheduleRetry()
    }
  }
  const flush = () => (chain = chain.then(drain))

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (ignore.has(origin)) return
    pending.push(update)
    // While a retry is scheduled, new edits just join the queue (no hammering a failing store).
    if (retryTimer === null) void flush()
  }
  doc.on('update', onUpdate)

  return {
    destroy: () => doc.off('update', onUpdate),
    flush,
    hasPending: () => pending.length > 0,
    isFailing: () => retryTimer !== null,
    pendingUpdate: () => (pending.length === 0 ? null : pending.length === 1 ? pending[0] : Y.mergeUpdates(pending)),
    retry() {
      if (retryTimer === null) return
      clearTimeout(retryTimer)
      retryTimer = null
      void flush()
    },
    async close() {
      closed = true
      doc.off('update', onUpdate)
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      pending.length = 0
      await chain
    },
  }
}
