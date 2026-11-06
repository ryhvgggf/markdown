import type { NotesDb } from '@/adapters/storage/db'
import type { Indexer } from '../indexer/indexer'
import type { Vault } from '../vault/vault'
import type { GraphSource, GraphSourceNote } from './graph-data'

/**
 * Reads the graph's input from the index: live notes (titles and folders from the vault, formulas from noteText)
 * and every link row. A row without `formulas` (not indexed yet, or rewritten by an older version) is re-indexed
 * first; a note that cannot be read counts as using no formulas.
 */
export async function loadGraphSource(db: NotesDb, vault: Vault, indexer: Indexer): Promise<GraphSource> {
  const metas = vault.listNotes()
  const rows = new Map((await db.noteText.toArray()).map((r) => [r.noteId, r.formulas]))
  const notes: GraphSourceNote[] = []
  for (const m of metas) {
    let formulas = rows.get(m.id)
    if (!formulas) {
      try {
        await indexer.indexNote(m.id)
        formulas = (await db.noteText.get(m.id))?.formulas
      } catch {
        // unreadable note: no formulas
      }
    }
    notes.push({ id: m.id, title: m.title, folderId: m.folderId, formulas: formulas ?? [] })
  }
  const links = (await db.links.toArray()).map((l) => ({ source: l.sourceNoteId, target: l.targetNoteId }))
  return { notes, links }
}
