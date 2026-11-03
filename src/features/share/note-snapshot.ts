import type { AppServices } from '@/app/bootstrap'
import { toJSON } from '@/app/doc-io'
import type { PMNode } from '@/core/markdown/types'
import { buildShareSnapshot, type ShareSnapshot } from '@/core/share/snapshot'
import { displayTitle } from '@/core/vault/titles'
import { noteLinkLabel } from '@/features/editor/links/note-link'

function linkTargets(node: PMNode, out: Array<{ noteId: string; blockId: string | null }> = []) {
  if (node.type === 'noteLink') out.push({ noteId: String(node.attrs?.noteId ?? ''), blockId: (node.attrs?.blockId as string | null) ?? null })
  for (const c of node.content ?? []) linkTargets(c, out)
  return out
}

/** The current content of a note as a share snapshot: links to other notes become the text the editor shows. */
export async function snapshotOfNote(s: Pick<AppServices, 'vault' | 'notes' | 'db'>, noteId: string, now = Date.now()): Promise<ShareSnapshot> {
  const note = s.vault.getNote(noteId)
  if (!note) throw new Error('note not found')
  const ydoc = await s.notes.acquire(noteId)
  let doc: PMNode
  try {
    doc = toJSON(ydoc)
  } finally {
    s.notes.release(noteId)
  }
  const texts = new Map<string, string | null>()
  for (const t of linkTargets(doc)) {
    if (!t.blockId || texts.has(`${t.noteId}#${t.blockId}`)) continue
    texts.set(`${t.noteId}#${t.blockId}`, (await s.db.blocks.get([t.noteId, t.blockId]))?.text ?? null)
  }
  return buildShareSnapshot({
    title: displayTitle(note.title),
    doc,
    sharedAt: now,
    linkLabel: (id, blockId) => {
      const n = s.vault.getNote(id)
      if (!n || n.deletedAt !== null) return null
      return noteLinkLabel(s.vault, { noteId: id, blockId }, blockId ? (texts.get(`${id}#${blockId}`) ?? null) : undefined).text
    },
  })
}
