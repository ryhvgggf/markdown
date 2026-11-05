import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { MAX_SHARE_NOTES, ShareError } from '@/adapters/share/types'
import type { PMNode } from '@/core/markdown/types'
import { ATTACHMENT_OMITTED_TEXT, newSanitizeBudget, sanitizeShareDoc } from './sanitize'
import { sanitizeShareFiles, type ShareFile } from './files'

export { ShareError }

/**
 * What a read-only link shows (phase 4a plan §1): the note's current content as ProseMirror JSON plus its title
 * and the time it was shared. Deliberately not the Yjs state, which would carry edit history and client ids.
 * Links to other notes become plain text (the viewer cannot open them) and attachments become a placeholder
 * (4d adds attachments), so neither note ids nor attachment ids leave the device.
 */
export interface ShareSnapshot {
  v: 1
  title: string
  sharedAt: number
  doc: PMNode
  /** Phase 4d: the attachments its `media` nodes point at (filled in by the share service on upload). */
  files?: ShareFile[]
}

export { ATTACHMENT_OMITTED_TEXT }
/** Upper bound for the compressed snapshot (also enforced by the database). */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** Upper bound for the inflated JSON, against forged sizes. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

/**
 * A multi-note link (plan `claude/multi-share-plan.md` §1). Each note has an in-snapshot code (`n0`, `n1`…, in
 * the order given) instead of its real id, so real note ids never leave the device. Links between notes of the
 * same snapshot stay links (pointing at the code); links to anything else become plain text, as in v1.
 */
export interface MultiShareSnapshot {
  v: 2
  sharedAt: number
  notes: MultiShareNote[]
  /** Phase 4d: as in `ShareSnapshot`, one list for all notes. */
  files?: ShareFile[]
}
export interface MultiShareNote {
  id: string
  title: string
  doc: PMNode
}
export type AnyShareSnapshot = ShareSnapshot | MultiShareSnapshot

/** The code of the `i`-th note of a multi-note snapshot. */
export const shareNoteCode = (i: number) => `n${i}`
const NOTE_CODE = /^n(?:0|[1-9]\d?)$/

type LinkLabel = (noteId: string, blockId: string | null) => string | null

/** Attachments to include (phase 4d): real attachment id → its in-snapshot code and MIME type. */
export type SnapshotFiles = ReadonlyMap<string, { code: string; mime: string }>
const mimesOf = (files: SnapshotFiles | undefined) => new Map([...(files?.values() ?? [])].map((f) => [f.code, f.mime]))

/**
 * Replaces attachments with the placeholder and rewrites note links: to `codes.get(noteId)` if the target is in
 * the snapshot (a v2 link, labelled), otherwise to the text the editor shows (dropped if the note is gone).
 */
function prepareDoc(root: PMNode, linkLabel: LinkLabel, codes?: ReadonlyMap<string, string>, files?: SnapshotFiles): PMNode {
  const placeholder = (): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text: ATTACHMENT_OMITTED_TEXT, marks: [{ type: 'italic' }] }] })

  const visit = (node: PMNode): PMNode[] => {
    if (node.type === 'media') {
      const f = files?.get(String(node.attrs?.attachmentId ?? ''))
      return f ? [{ type: 'media', attrs: { ...node.attrs, attachmentId: f.code } }] : [placeholder()]
    }
    if (node.type === 'noteLink') {
      const attrs = node.attrs ?? {}
      const noteId = String(attrs.noteId ?? '')
      const blockId = (attrs.blockId as string | null) ?? null
      const stored = typeof attrs.label === 'string' ? attrs.label : null
      const text = linkLabel(noteId, blockId) ?? stored
      if (!text) return []
      const code = codes?.get(noteId)
      if (code) return [{ type: 'noteLink', attrs: { noteId: code, blockId, label: text }, ...(node.marks?.length && { marks: node.marks }) }]
      return [{ type: 'text', text, ...(node.marks?.length && { marks: node.marks }) }]
    }
    if (!node.content) return [node]
    return [{ ...node, content: node.content.flatMap(visit) }]
  }
  return visit(root)[0]
}

export function buildShareSnapshot(input: {
  title: string
  doc: PMNode
  sharedAt: number
  /** The text a link to another note shows (e.g. its title, or "title › block"); null if the note is gone. */
  linkLabel: LinkLabel
  /** Attachments to keep (the others become the placeholder); their `files` entries are added on upload. */
  files?: SnapshotFiles
}): ShareSnapshot {
  // The same allow-list the share page applies on opening (belt and braces).
  const doc = sanitizeShareDoc(prepareDoc(input.doc, input.linkLabel, undefined, input.files), { files: mimesOf(input.files) })
  return { v: 1, title: input.title, sharedAt: input.sharedAt, doc }
}

/**
 * A multi-note snapshot of `notes` (1 to `MAX_SHARE_NOTES`, distinct, in the order the share page lists them).
 * `ShareError('invalid')` for an empty, too long or repeating list.
 */
export function buildMultiShareSnapshot(input: {
  notes: Array<{ noteId: string; title: string; doc: PMNode }>
  sharedAt: number
  linkLabel: LinkLabel
  files?: SnapshotFiles
}): MultiShareSnapshot {
  const { notes } = input
  if (notes.length < 1 || notes.length > MAX_SHARE_NOTES) throw new ShareError('invalid', 'bad note count')
  const codes = new Map(notes.map((n, i) => [n.noteId, shareNoteCode(i)]))
  if (codes.size !== notes.length) throw new ShareError('invalid', 'repeated note')
  const s: MultiShareSnapshot = {
    v: 2,
    sharedAt: input.sharedAt,
    notes: notes.map((n, i) => ({ id: shareNoteCode(i), title: n.title, doc: prepareDoc(n.doc, input.linkLabel, codes, input.files) })),
  }
  return sanitizeNotes(s, mimesOf(input.files))
}

function sanitizeNotes(s: MultiShareSnapshot, files: ReadonlyMap<string, string>): MultiShareSnapshot {
  const budget = newSanitizeBudget()
  const linkTargets = new Set(s.notes.map((n) => n.id))
  return { ...s, notes: s.notes.map((n) => ({ id: n.id, title: n.title, doc: sanitizeShareDoc(n.doc, { linkTargets, budget, files }) })) }
}

/**
 * The allow-listed copy of a decoded snapshot (run when building and again when opening). A multi-note snapshot
 * shares one node budget across its notes, and only links to its own codes survive as links.
 */
export function sanitizeSnapshot<S extends AnyShareSnapshot>(s: S): S {
  const snap: AnyShareSnapshot = s
  const files = sanitizeShareFiles(snap.files)
  const mimes = new Map(files.map((f) => [f.code, f.mime]))
  const out: AnyShareSnapshot =
    snap.v === 1
      ? { v: 1, title: snap.title, sharedAt: snap.sharedAt, doc: sanitizeShareDoc(snap.doc, { files: mimes }) }
      : sanitizeNotes({ v: 2, sharedAt: snap.sharedAt, notes: snap.notes }, mimes)
  if (files.length) out.files = files
  return out as S
}

/** gzip(JSON). Throws `ShareError('too-large')` past `MAX_SNAPSHOT_BYTES`. */
export function encodeSnapshot(s: AnyShareSnapshot): Uint8Array {
  const bytes = gzipSync(strToU8(JSON.stringify(s)), { level: 9 })
  if (bytes.length > MAX_SNAPSHOT_BYTES) throw new ShareError('too-large')
  return bytes
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isDoc = (v: unknown) => isObj(v) && v.type === 'doc'
/** Untrusted until `sanitizeSnapshot` (which callers run right after decoding). */
const filesOf = (v: Record<string, unknown>) => (Array.isArray(v.files) ? { files: v.files as ShareFile[] } : {})

/** Inverse of `encodeSnapshot`; throws `ShareError('invalid')` for anything that is not a snapshot (v1 or v2). */
export function decodeSnapshot(bytes: Uint8Array): AnyShareSnapshot {
  let value: unknown
  try {
    if (bytes.length < 18) throw new Error('short')
    const inflated = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true)
    if (inflated > MAX_INFLATED_BYTES) throw new Error('too big')
    value = JSON.parse(strFromU8(gunzipSync(bytes)))
  } catch (e) {
    throw new ShareError('invalid', 'not a snapshot', { cause: e })
  }
  if (!isObj(value) || typeof value.sharedAt !== 'number') throw new ShareError('invalid', 'not a snapshot')
  if (value.v === 1) {
    if (typeof value.title !== 'string' || !isDoc(value.doc)) throw new ShareError('invalid', 'not a snapshot')
    return { v: 1, title: value.title, sharedAt: value.sharedAt, doc: value.doc as PMNode, ...filesOf(value) }
  }
  if (value.v === 2) {
    const notes = value.notes
    if (!Array.isArray(notes) || notes.length < 1 || notes.length > MAX_SHARE_NOTES) throw new ShareError('invalid', 'not a snapshot')
    const seen = new Set<string>()
    const out: MultiShareNote[] = []
    for (const n of notes) {
      if (!isObj(n) || typeof n.id !== 'string' || !NOTE_CODE.test(n.id) || seen.has(n.id) || typeof n.title !== 'string' || !isDoc(n.doc))
        throw new ShareError('invalid', 'not a snapshot')
      seen.add(n.id)
      out.push({ id: n.id, title: n.title, doc: n.doc as PMNode })
    }
    return { v: 2, sharedAt: value.sharedAt, notes: out, ...filesOf(value) }
  }
  throw new ShareError('invalid', 'not a snapshot')
}
