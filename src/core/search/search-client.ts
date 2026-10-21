import type { SearchHit } from './search'

type Pending = { resolve: (h: SearchHit[]) => void; reject: (e: Error) => void }
type Reply = { id: number; hits?: SearchHit[]; error?: string }

export class SearchClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(opts: { dbName?: string } = {}) {
    this.worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.postMessage({ kind: 'init', dbName: opts.dbName ?? 'notes-v2' })
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.error !== undefined) p.reject(new Error(e.data.error))
      else p.resolve(e.data.hits ?? [])
    }
  }

  search(query: string): Promise<SearchHit[]> {
    return this.request({ kind: 'search', query })
  }

  mentions(title: string, excludeNoteIds: string[]): Promise<SearchHit[]> {
    return this.request({ kind: 'mentions', title, excludeNoteIds })
  }

  dispose(): void {
    this.worker.terminate()
    for (const p of this.pending.values()) p.reject(new Error('SearchClient disposed'))
    this.pending.clear()
  }

  private request(msg: object): Promise<SearchHit[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, ...msg })
    })
  }
}
