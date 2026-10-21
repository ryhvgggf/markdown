import type { NoteTextRow } from '../adapters/storage/db'
import { findMentions, searchNotes, type SearchHit } from '../core/search/search'

export type SearchRequest =
  | { kind: 'init'; dbName: string }
  | { id: number; kind: 'search'; query: string }
  | { id: number; kind: 'mentions'; title: string; excludeNoteIds: string[] }

export type SearchReply = { id: number; hits: SearchHit[] } | { id: number; error: string }

export interface SearchState {
  rows: NoteTextRow[]
  tags: Map<string, string[]>
  /** Set while a data source's liveQuery is in error; requests fail instead of using stale data. */
  error: string | null
}

export function handleRequest(
  state: SearchState,
  req: Exclude<SearchRequest, { kind: 'init' }>,
): SearchReply {
  if (state.error !== null) return { id: req.id, error: state.error }
  try {
    const hits =
      req.kind === 'search'
        ? searchNotes(req.query, state.rows, state.tags)
        : findMentions(req.title, state.rows, new Set(req.excludeNoteIds))
    return { id: req.id, hits }
  } catch (err) {
    return { id: req.id, error: err instanceof Error ? err.message : String(err) }
  }
}
