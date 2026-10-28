import type { ParseResult } from '@/core/markdown/types'
import { parseFiles, serializeItems, type ParseFile, type SerializeItem, type SharedContext, type TransferReply } from './transfer-ops'

/** Markdown conversion off the main thread (inline where Worker is unavailable, e.g. tests). */
export type TransferClient = {
  serialize(items: SerializeItem[], shared: SharedContext): Promise<string[]>
  parse(files: ParseFile[]): Promise<ParseResult[]>
}

export function inlineTransferClient(): TransferClient {
  return {
    serialize: async (items, shared) => serializeItems(items, shared),
    parse: async (files) => parseFiles(files),
  }
}

export function createTransferClient(createWorker?: () => Worker): TransferClient {
  if (!createWorker && typeof Worker === 'undefined') return inlineTransferClient()
  let worker: Worker | null = null
  let next = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const fallback = inlineTransferClient()
  let broken = false
  const get = (): Worker => {
    if (worker) return worker
    worker = createWorker ? createWorker() : new Worker(new URL('../../workers/transfer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<TransferReply>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error !== undefined) p.reject(new Error(e.data.error))
      else p.resolve(e.data.result)
    }
    worker.onerror = () => {
      broken = true
      for (const p of pending.values()) p.reject(new Error('transfer worker failed'))
      pending.clear()
    }
    return worker
  }
  const call = <T>(msg: object): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      get().postMessage({ id, ...msg })
    })
  return {
    serialize: (items, shared) => (broken ? fallback.serialize(items, shared) : call<string[]>({ op: 'serialize', items, shared })),
    parse: (files) => (broken ? fallback.parse(files) : call<ParseResult[]>({ op: 'parse', files })),
  }
}
