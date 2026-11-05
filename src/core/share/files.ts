import { MAX_SHARE_FILE_BYTES, MAX_SHARE_FILES_BYTES } from '@/adapters/share/types'
import type { PMNode } from '@/core/markdown/types'

/**
 * Attachments of a share link (phase 4d, plan `claude/share-attachments-plan.md`). In the snapshot, a `media`
 * node points at an in-snapshot code (`a0`, `a1`…) instead of the real attachment id, and the snapshot's `files`
 * list says where each code's encrypted copy is and how to open it. Real attachment ids never leave the device.
 */
export interface ShareFile {
  code: string
  /** Random object name (128 bits, base64url) inside the link's folder. */
  obj: string
  /** The file's own AES-256 key (base64url, 32 bytes). Only ever inside the encrypted snapshot. */
  key: string
  /** HMAC of the real attachment id under `key` (owner side: reuse the upload when the snapshot is updated). */
  ref: string
  name: string
  mime: string
  /** Plaintext size in bytes. */
  size: number
  /** Download token of the stored object (signed by the owner; see `ShareAdapter.signFiles`). */
  token: string
}

/** An attachment going into a snapshot, before upload (built on the owner's device). */
export interface PendingShareFile {
  code: string
  attachmentId: string
  name: string
  mime: string
  /** Size the device records for it (checked against the limits before anything is uploaded). */
  size: number
  /** The attachment's bytes (read only when it has to be uploaded). */
  read(): Promise<Uint8Array>
}

export const shareFileCode = (i: number) => `a${i}`
export const FILE_CODE = /^a(?:0|[1-9]\d{0,2})$/
/** Most files one snapshot may list (codes `a0`–`a999`). */
export const MAX_SHARE_FILE_COUNT = 1000
const OBJ = /^[A-Za-z0-9_-]{22}$/
const KEY32 = /^[A-Za-z0-9_-]{43}$/
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const MAX_TOKEN = 4096
const MIME = /^[a-z0-9][a-z0-9.+-]{0,40}\/[a-z0-9][a-z0-9.+-]{0,60}$/
const MAX_NAME = 200
const FALLBACK_MIME = 'application/octet-stream'

/** Shown inline on the share page; anything else (SVG included) is offered as a download only. */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const INLINE_VIDEO = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'])

/** How the share page may show a file: inline only for the allow-listed image and video types. */
export function shareMediaKind(kind: unknown, mime: string): 'image' | 'video' | 'file' {
  if (kind === 'image' && INLINE_IMAGE.has(mime)) return 'image'
  if (kind === 'video' && INLINE_VIDEO.has(mime)) return 'video'
  return 'file'
}

/**
 * The type to give a decrypted file's Blob on the share page (which shares the app's origin): its own type only
 * for an inline image or video; anything else is `application/octet-stream` and offered as a download only, so
 * an HTML or SVG file can never be opened as a page.
 */
export const shareBlobType = (f: Pick<ShareFile, 'mime'>, kind: 'image' | 'video' | 'file') =>
  kind !== 'file' && shareMediaKind(kind, f.mime) === kind ? f.mime : FALLBACK_MIME

/** The real attachment ids of `media` nodes in `docs`, in order of first appearance. */
export function collectAttachmentIds(docs: PMNode[]): string[] {
  const seen = new Set<string>()
  const visit = (n: PMNode) => {
    if (n.type === 'media') {
      const id = n.attrs?.attachmentId
      if (typeof id === 'string' && id) seen.add(id)
    }
    for (const c of n.content ?? []) visit(c)
  }
  docs.forEach(visit)
  return [...seen]
}

/** Direction controls (they can disguise an extension: `invoice\u202Efdp.exe`). */
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const cleanName = (v: unknown) => {
  const s = typeof v === 'string' ? [...v].filter((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f).join('').trim() : ''
  return [...s].filter((c) => !BIDI.test(c)).slice(0, MAX_NAME).join('') || 'file'
}
const cleanMime = (v: unknown) => (typeof v === 'string' && MIME.test(v.toLowerCase()) ? v.toLowerCase() : FALLBACK_MIME)

/**
 * The allow-listed copy of a snapshot's `files` (untrusted on the share page): well-formed entries with distinct
 * codes, each within `MAX_SHARE_FILE_BYTES`, together within `MAX_SHARE_FILES_BYTES`; everything else is dropped.
 */
export function sanitizeShareFiles(raw: unknown): ShareFile[] {
  if (!Array.isArray(raw)) return []
  const out: ShareFile[] = []
  const codes = new Set<string>()
  let total = 0
  for (const f of raw.slice(0, MAX_SHARE_FILE_COUNT)) {
    if (!isObj(f)) continue
    const { code, obj, key, ref, size, token } = f
    if (typeof code !== 'string' || !FILE_CODE.test(code) || codes.has(code)) continue
    if (typeof obj !== 'string' || !OBJ.test(obj) || typeof key !== 'string' || !KEY32.test(key) || typeof ref !== 'string' || !KEY32.test(ref)) continue
    if (typeof token !== 'string' || token.length > MAX_TOKEN || !TOKEN.test(token)) continue
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > MAX_SHARE_FILE_BYTES || total + size > MAX_SHARE_FILES_BYTES) continue
    codes.add(code)
    total += size
    out.push({ code, obj, key, ref, name: cleanName(f.name), mime: cleanMime(f.mime), size, token })
  }
  return out
}

/** Name and MIME type the snapshot records for a pending file (same cleaning as on the share page). */
export const cleanFileInfo = (name: unknown, mime: unknown) => ({ name: cleanName(name), mime: cleanMime(mime) })
