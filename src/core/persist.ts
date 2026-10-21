import * as Y from 'yjs'
import { StorageError, type StorageAdapter } from '@/adapters/storage/types'

export const PERSIST_ORIGIN: unique symbol = Symbol('persist')

export interface PersistOptions {
  compactAfter?: number
  ignoreOrigins?: unknown[]
  onError?: (e: StorageError) => void
}

export async function bindPersistence(
  doc: Y.Doc,
  docId: string,
  storage: StorageAdapter,
  opts: PersistOptions = {},
): Promise<{ destroy(): void; flush(): Promise<void> }> {
  const compactAfter = opts.compactAfter ?? 200
  const ignore = new Set<unknown>([PERSIST_ORIGIN, ...(opts.ignoreOrigins ?? [])])

  const stored = await storage.loadDoc(docId)
  doc.transact(() => {
    for (const u of stored) Y.applyUpdate(doc, u, PERSIST_ORIGIN)
  }, PERSIST_ORIGIN)

  let count = stored.length
  const pending: Uint8Array[] = []
  let chain: Promise<void> = Promise.resolve()

  const drain = async () => {
    try {
      while (pending.length > 0) {
        count = await storage.appendUpdate(docId, pending[0])
        pending.shift()
        if (count >= compactAfter) {
          await storage.compact(docId, Y.encodeStateAsUpdate(doc))
          count = 0
        }
      }
    } catch (e) {
      opts.onError?.(e instanceof StorageError ? e : new StorageError('unknown', String(e), { cause: e }))
    }
  }
  const flush = () => (chain = chain.then(drain))

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (ignore.has(origin)) return
    pending.push(update)
    void flush()
  }
  doc.on('update', onUpdate)

  return {
    destroy: () => doc.off('update', onUpdate),
    flush,
  }
}
