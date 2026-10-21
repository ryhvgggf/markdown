/// <reference lib="webworker" />
// Data freshness: Dexie liveQuery keeps an in-memory cache of noteText rows and
// the tag map; Dexie 4 propagates changes made in other browser contexts.
// On liveQuery error the source is flagged (requests reply with an error) and
// re-subscribed after a delay so the cache can recover.
import { liveQuery } from 'dexie'
import { createDb } from '../adapters/storage/db'
import { respond, type SearchRequest, type SearchState } from './search-handler'

const RETRY_MS = 1000
const state: SearchState = { rows: [], tags: new Map(), error: null }
const errors = new Map<string, string>()

let resolveInit: (name: string) => void = () => {}
const initialized = new Promise<string>((r) => (resolveInit = r))

function syncError(): void {
  const first = errors.values().next()
  state.error = first.done ? null : first.value
}

function watch<T>(
  name: string,
  query: () => Promise<T>,
  apply: (v: T) => void,
  settled: () => void,
): void {
  const sub = liveQuery(query).subscribe({
    next: (v) => {
      apply(v)
      errors.delete(name)
      syncError()
      settled()
    },
    error: (e: unknown) => {
      errors.set(name, `Search index unavailable: ${e instanceof Error ? e.message : String(e)}`)
      syncError()
      settled()
      sub.unsubscribe()
      setTimeout(() => watch(name, query, apply, settled), RETRY_MS)
    },
  })
}

const ready: Promise<void> = initialized.then(
  (dbName) =>
    new Promise<void>((resolve) => {
      const db = createDb(dbName)
      const done = new Set<string>()
      const settle = (n: string) => () => {
        done.add(n)
        if (done.size === 2) resolve()
      }
      watch('noteText', () => db.noteText.toArray(), (v) => (state.rows = v), settle('noteText'))
      watch(
        'tags',
        () => db.tags.toArray(),
        (v) => {
          const m = new Map<string, string[]>()
          for (const t of v) {
            const list = m.get(t.noteId)
            if (list) list.push(t.tag)
            else m.set(t.noteId, [t.tag])
          }
          state.tags = m
        },
        settle('tags'),
      )
    }),
)

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const req = e.data
  if (req.kind === 'init') {
    resolveInit(req.dbName)
    return
  }
  self.postMessage(await respond(state, req, ready))
}
