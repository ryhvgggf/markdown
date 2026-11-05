import type { AppServices } from '@/app/bootstrap'
import { toJSON } from '@/app/doc-io'
import type { PMNode } from '@/core/markdown/types'
import type { MultiShareContent } from '@/core/share/share-service'
import { collectAttachmentIds, shareFileCode, type PendingShareFile } from '@/core/share/files'
import { buildMultiShareSnapshot, buildShareSnapshot, type ShareSnapshot, type SnapshotFiles } from '@/core/share/snapshot'
import { displayTitle } from '@/core/vault/titles'
import { noteLinkLabel } from '@/features/editor/links/note-link'

function linkTargets(node: PMNode, out: Array<{ noteId: string; blockId: string | null }> = []) {
  if (node.type === 'noteLink') out.push({ noteId: String(node.attrs?.noteId ?? ''), blockId: (node.attrs?.blockId as string | null) ?? null })
  for (const c of node.content ?? []) linkTargets(c, out)
  return out
}

type Services = Pick<AppServices, 'vault' | 'notes' | 'db'>
type FileServices = Services & Pick<AppServices, 'storage'>

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

/**
 * Phase 4d: the attachments of `docs` that can go into a link — not in the trash and downloaded to this device —
 * with their in-snapshot codes. `missing` counts the ones only another device has (they stay "附件未包含").
 */
async function filesOf(s: FileServices, docs: PMNode[]): Promise<{ map: SnapshotFiles; pending: PendingShareFile[]; missing: number }> {
  const map = new Map<string, { code: string; mime: string }>()
  const pending: PendingShareFile[] = []
  let missing = 0
  for (const id of collectAttachmentIds(docs)) {
    const meta = s.vault.getAttachment(id)
    if (!meta || meta.deletedAt !== null) continue
    const blob = await s.storage.getBlob(id)
    if (!blob) {
      missing++
      continue
    }
    const code = shareFileCode(pending.length)
    map.set(id, { code, mime: meta.mimeType })
    pending.push({
      code,
      attachmentId: id,
      name: meta.filename,
      mime: meta.mimeType,
      size: blob.size,
      read: async () => new Uint8Array(await blob.arrayBuffer()),
    })
  }
  return { map, pending, missing }
}

/** Like `snapshotOfNote`, with the note's attachments (pass `files` to `ShareService.create`/`update`). */
export async function shareContentOfNote(s: FileServices, noteId: string, now = Date.now()) {
  const { title, doc } = await contentOf(s, noteId)
  const { map, pending, missing } = await filesOf(s, [doc])
  const snapshot = buildShareSnapshot({ title, doc, sharedAt: now, linkLabel: await labelsFor(s, [doc]), files: map })
  return { snapshot, files: pending, missing }
}

/** Like `snapshotOfNotes`, with the notes' attachments (one list for all of them). */
export async function shareContentOfNotes(s: FileServices, noteIds: string[], now = Date.now()): Promise<MultiShareContent & { missing: number }> {
  const notes = []
  for (const noteId of noteIds) notes.push({ noteId, ...(await contentOf(s, noteId)) })
  const docs = notes.map((n) => n.doc)
  const { map, pending, missing } = await filesOf(s, docs)
  const snapshot = buildMultiShareSnapshot({ notes, sharedAt: now, linkLabel: await labelsFor(s, docs), files: map })
  return { noteIds: [...noteIds], snapshot, files: pending, missing }
}
