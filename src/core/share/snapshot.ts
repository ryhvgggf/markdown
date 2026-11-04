import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { ShareError } from '@/adapters/share/types'
import type { PMNode } from '@/core/markdown/types'
import { ATTACHMENT_OMITTED_TEXT, sanitizeShareDoc } from './sanitize'

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
}

export { ATTACHMENT_OMITTED_TEXT }
/** Upper bound for the compressed snapshot (also enforced by the database). */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** Upper bound for the inflated JSON, against forged sizes. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

export function buildShareSnapshot(input: {
  title: string
  doc: PMNode
  sharedAt: number
  /** The text a link to another note shows (e.g. its title, or "title › block"); null if the note is gone. */
  linkLabel: (noteId: string, blockId: string | null) => string | null
}): ShareSnapshot {
  const placeholder = (): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text: ATTACHMENT_OMITTED_TEXT, marks: [{ type: 'italic' }] }] })

  const visit = (node: PMNode): PMNode[] => {
    if (node.type === 'media') return [placeholder()]
    if (node.type === 'noteLink') {
      const attrs = node.attrs ?? {}
      const stored = typeof attrs.label === 'string' ? attrs.label : null
      const text = input.linkLabel(String(attrs.noteId ?? ''), (attrs.blockId as string | null) ?? null) ?? stored
      if (!text) return []
      return [{ type: 'text', text, ...(node.marks?.length && { marks: node.marks }) }]
    }
    if (!node.content) return [node]
    return [{ ...node, content: node.content.flatMap(visit) }]
  }

  const [doc] = visit(input.doc)
  // The same allow-list the share page applies on opening (belt and braces).
  return { v: 1, title: input.title, sharedAt: input.sharedAt, doc: sanitizeShareDoc(doc) }
}

/** gzip(JSON). Throws `ShareError('too-large')` past `MAX_SNAPSHOT_BYTES`. */
export function encodeSnapshot(s: ShareSnapshot): Uint8Array {
  const bytes = gzipSync(strToU8(JSON.stringify(s)), { level: 9 })
  if (bytes.length > MAX_SNAPSHOT_BYTES) throw new ShareError('too-large')
  return bytes
}

/** Inverse of `encodeSnapshot`; throws `ShareError('invalid')` for anything that is not a snapshot. */
export function decodeSnapshot(bytes: Uint8Array): ShareSnapshot {
  let value: unknown
  try {
    if (bytes.length < 18) throw new Error('short')
    const inflated = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true)
    if (inflated > MAX_INFLATED_BYTES) throw new Error('too big')
    value = JSON.parse(strFromU8(gunzipSync(bytes)))
  } catch (e) {
    throw new ShareError('invalid', 'not a snapshot', { cause: e })
  }
  const s = value as Partial<ShareSnapshot> | null
  const ok =
    !!s &&
    s.v === 1 &&
    typeof s.title === 'string' &&
    typeof s.sharedAt === 'number' &&
    !!s.doc &&
    typeof s.doc === 'object' &&
    s.doc.type === 'doc'
  if (!ok) throw new ShareError('invalid', 'not a snapshot')
  return s as ShareSnapshot
}
