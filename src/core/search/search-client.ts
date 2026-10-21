import type { SearchHit } from './search'

type Pending = { resolve: (h: SearchHit[]) => void; reject: (e: Error) => void }
type Reply = { id: number; hits?: SearchHit[]; error?: string }

export interface SearchClientOptions {
  dbName?: string
  /** Injectable for tests; default creates the real module worker. */
  createWorker?: () => Worker
}

export class SearchClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()
  private fatal: Error | null = null

  constructor(opts: SearchClientOptions = {}) {
    this.worker = opts.createWorker
      ? opts.createWorker()
      : new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
          type: 'module',
        })
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.error !== undefined) p.reject(new Error(e.data.error))
      else p.resolve(e.data.hits ?? [])
    }
    this.worker.onerror = (e: ErrorEvent) =>
      this.fail(new Error(`Search worker failed: ${e.message || 'unknown error'}`))
    this.worker.onmessageerror = () =>
      this.fail(new Error('Search worker failed: message could not be deserialized'))
    this.worker.postMessage({ kind: 'init', dbName: opts.dbName ?? 'notes-v2' })
  }

  search(query: string): Promise<SearchHit[]> {
    return this.request({ kind: 'search', query })
  }

  mentions(title: string, excludeNoteIds: string[]): Promise<SearchHit[]> {
    return this.request({ kind: 'mentions', title, excludeNoteIds })
  }

  dispose(): void {
    this.worker.terminate()
    this.fail(new Error('SearchClient disposed'))
  }

  private fail(err: Error): void {
    this.fatal ??= err
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private request(msg: object): Promise<SearchHit[]> {
    if (this.fatal) return Promise.reject(this.fatal)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, ...msg })
    })
  }
}
