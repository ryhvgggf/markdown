import type { NotesDb } from '@/adapters/storage/db'
import { findMentions, searchNotes, type SearchHit } from './search'

export interface SearchService {
  search(query: string): Promise<SearchHit[]>
  mentions(title: string, excludeNoteIds: string[]): Promise<SearchHit[]>
  dispose(): void
}

/** In-process search used when the worker cannot see the database (memory mode). */
export class LocalSearch implements SearchService {
  constructor(private readonly db: NotesDb) {}

  async search(query: string): Promise<SearchHit[]> {
    const [rows, tagRows] = await Promise.all([this.db.noteText.toArray(), this.db.tags.toArray()])
    const tags = new Map<string, string[]>()
    for (const t of tagRows) {
      const list = tags.get(t.noteId)
      if (list) list.push(t.tag)
      else tags.set(t.noteId, [t.tag])
    }
    return searchNotes(query, rows, tags)
  }

  async mentions(title: string, excludeNoteIds: string[]): Promise<SearchHit[]> {
    return findMentions(title, await this.db.noteText.toArray(), new Set(excludeNoteIds))
  }

  dispose(): void {}
}
