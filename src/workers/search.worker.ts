/// <reference lib="webworker" />
// Data freshness: Dexie liveQuery keeps an in-memory cache of noteText rows and
// the tag map; Dexie 4 propagates changes made in other browser contexts.
import { liveQuery } from 'dexie'
import { createDb, type NoteTextRow } from '../adapters/storage/db'
import { findMentions, searchNotes } from '../core/search/search'

export type SearchRequest =
  | { kind: 'init'; dbName: string }
  | { id: number; kind: 'search'; query: string }
  | { id: number; kind: 'mentions'; title: string; excludeNoteIds: string[] }

let rows: NoteTextRow[] = []
let tags = new Map<string, string[]>()
let resolveInit: (name: string) => void = () => {}
const initialized = new Promise<string>((r) => (resolveInit = r))

const ready: Promise<void> = initialized.then(
  (dbName) =>
    new Promise<void>((resolve) => {
      const db = createDb(dbName)
      let gotRows = false
      let gotTags = false
      const check = () => {
        if (gotRows && gotTags) resolve()
      }
      liveQuery(() => db.noteText.toArray()).subscribe({
        next: (v) => {
          rows = v
          gotRows = true
          check()
        },
        error: () => {
          gotRows = true
          check()
        },
      })
      liveQuery(() => db.tags.toArray()).subscribe({
        next: (v) => {
          const m = new Map<string, string[]>()
          for (const t of v) {
            const list = m.get(t.noteId)
            if (list) list.push(t.tag)
            else m.set(t.noteId, [t.tag])
          }
          tags = m
          gotTags = true
          check()
        },
        error: () => {
          gotTags = true
          check()
        },
      })
    }),
)

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const req = e.data
  if (req.kind === 'init') {
    resolveInit(req.dbName)
    return
  }
  try {
    await ready
    const hits =
      req.kind === 'search'
        ? searchNotes(req.query, rows, tags)
        : findMentions(req.title, rows, new Set(req.excludeNoteIds))
    self.postMessage({ id: req.id, hits })
  } catch (err) {
    self.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) })
  }
}
