import type { AppServices } from '@/app/bootstrap'
import { toJSON } from '@/app/doc-io'
import type { PMNode } from '@/core/markdown/types'
import type { MultiShareContent } from '@/core/share/share-service'
import { buildMultiShareSnapshot, buildShareSnapshot, type ShareSnapshot } from '@/core/share/snapshot'
import { displayTitle } from '@/core/vault/titles'
import { noteLinkLabel } from '@/features/editor/links/note-link'

function linkTargets(node: PMNode, out: Array<{ noteId: string; blockId: string | null }> = []) {
  if (node.type === 'noteLink') out.push({ noteId: String(node.attrs?.noteId ?? ''), blockId: (node.attrs?.blockId as string | null) ?? null })
  for (const c of node.content ?? []) linkTargets(c, out)
  return out
}

type Services = Pick<AppServices, 'vault' | 'notes' | 'db'>

async function contentOf(s: Services, noteId: string) {
  const note = s.vault.getNote(noteId)
  if (!note) throw new Error('note not found')
  const ydoc = await s.notes.acquire(noteId)
  try {
    return { title: displayTitle(note.title), doc: toJSON(ydoc) }
  } finally {
    s.notes.release(noteId)
  }
}

/** The text the editor shows for each link in `docs` (block texts looked up once). */
async function labelsFor(s: Services, docs: PMNode[]) {
  const texts = new Map<string, string | null>()
  for (const t of docs.flatMap((d) => linkTargets(d))) {
    if (!t.blockId || texts.has(`${t.noteId}#${t.blockId}`)) continue
    texts.set(`${t.noteId}#${t.blockId}`, (await s.db.blocks.get([t.noteId, t.blockId]))?.text ?? null)
  }
  return (id: string, blockId: string | null) => {
    const n = s.vault.getNote(id)
    if (!n || n.deletedAt !== null) return null
    return noteLinkLabel(s.vault, { noteId: id, blockId }, blockId ? (texts.get(`${id}#${blockId}`) ?? null) : undefined).text
  }
}

/** The current content of a note as a share snapshot: links to other notes become the text the editor shows. */
export async function snapshotOfNote(s: Services, noteId: string, now = Date.now()): Promise<ShareSnapshot> {
  const { title, doc } = await contentOf(s, noteId)
  return buildShareSnapshot({ title, doc, sharedAt: now, linkLabel: await labelsFor(s, [doc]) })
}

/**
 * The current content of several notes as one multi-note snapshot (with the ids it was built from), in order: links between them stay
 * links (to in-snapshot codes), links to anything else become the text the editor shows.
 */
export async function snapshotOfNotes(s: Services, noteIds: string[], now = Date.now()): Promise<MultiShareContent> {
  const notes = []
  for (const noteId of noteIds) notes.push({ noteId, ...(await contentOf(s, noteId)) })
  const snapshot = buildMultiShareSnapshot({ notes, sharedAt: now, linkLabel: await labelsFor(s, notes.map((n) => n.doc)) })
  return { noteIds: [...noteIds], snapshot }
}
