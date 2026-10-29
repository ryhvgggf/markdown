import type { NoteTextRow } from '../../adapters/storage/db'

export type SearchHit = {
  noteId: string
  title: string
  field: 'title' | 'tag' | 'content'
  snippet: string
  updatedAt: number
}

const RANK = { title: 0, tag: 1, content: 2 } as const
const CONTEXT = 30
const TITLE_SNIPPET = 60

function contentSnippet(text: string, index: number, len: number): string {
  const start = Math.max(0, index - CONTEXT)
  const end = Math.min(text.length, index + len + CONTEXT)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

function headSnippet(text: string): string {
  return text.length > TITLE_SNIPPET ? text.slice(0, TITLE_SNIPPET) + '…' : text
}

function bySort(a: SearchHit, b: SearchHit): number {
  return RANK[a.field] - RANK[b.field] || b.updatedAt - a.updatedAt
}

/** Literal, case-insensitive search (toLowerCase + indexOf; never a RegExp). */
export function searchNotes(
  query: string,
  rows: NoteTextRow[],
  tags: Map<string, string[]>,
  opts: { limit?: number } = {},
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const limit = opts.limit ?? 50
  const hits: SearchHit[] = []
  for (const r of rows) {
    if (r.trashed) continue
    const base = { noteId: r.noteId, title: r.title, updatedAt: r.updatedAt }
    if (r.title.toLowerCase().includes(q)) {
      hits.push({ ...base, field: 'title', snippet: headSnippet(r.text) })
      continue
    }
    const tag = (tags.get(r.noteId) ?? []).find((t) => t.toLowerCase().includes(q))
    if (tag !== undefined) {
      hits.push({ ...base, field: 'tag', snippet: `#${tag}` })
      continue
    }
    const i = r.text.toLowerCase().indexOf(q)
    if (i >= 0) hits.push({ ...base, field: 'content', snippet: contentSnippet(r.text, i, q.length) })
  }
  return hits.sort(bySort).slice(0, limit)
}

/** Notes carrying a tag that contains `query` (case-insensitive); independent of title/content ranking. */
export function searchByTag(
  query: string,
  rows: NoteTextRow[],
  tags: Map<string, string[]>,
  opts: { limit?: number } = {},
): SearchHit[] {
  const q = query.trim().replace(/^#/, '').toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const r of rows) {
    if (r.trashed) continue
    const tag = (tags.get(r.noteId) ?? []).find((t) => t.toLowerCase().includes(q))
    if (tag === undefined) continue
    hits.push({ noteId: r.noteId, title: r.title, field: 'tag', snippet: `#${tag}`, updatedAt: r.updatedAt })
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, opts.limit ?? 50)
}

export type TagInfo = { tag: string; count: number }

/** Every distinct tag in use (untrashed notes only), most-used first, ties broken alphabetically. */
export function listTags(rows: NoteTextRow[], tags: Map<string, string[]>): TagInfo[] {
  const live = new Set(rows.filter((r) => !r.trashed).map((r) => r.noteId))
  const counts = new Map<string, number>()
  for (const [noteId, list] of tags) {
    if (!live.has(noteId)) continue
    for (const tag of list) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Notes whose body (not title) mentions `title`; excluded ids and same-titled notes are skipped. */
export function findMentions(
  title: string,
  rows: NoteTextRow[],
  excludeNoteIds: Set<string>,
): SearchHit[] {
  const q = title.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const r of rows) {
    if (r.trashed || excludeNoteIds.has(r.noteId) || r.title.trim().toLowerCase() === q) continue
    const i = r.text.toLowerCase().indexOf(q)
    if (i < 0) continue
    hits.push({
      noteId: r.noteId,
      title: r.title,
      field: 'content',
      snippet: contentSnippet(r.text, i, q.length),
      updatedAt: r.updatedAt,
    })
  }
  return hits.sort(bySort)
}
