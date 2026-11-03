import { importRawShareKey } from '@/core/sync-engine/doc-crypto'

/**
 * Share link format (phase 4a plan §1): `<origin>/s/<shareId>#<share key>`. Both parts are base64url. The part
 * after `#` is never sent to any server, so only people holding the link can decrypt the snapshot.
 */

const B64URL = /^[A-Za-z0-9_-]+$/
const SHARE_ID = /^[A-Za-z0-9_-]{16,64}$/
const KEY_CHARS = 43 // 32 bytes, unpadded

export function toB64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64Url(s: string): Uint8Array {
  if (!B64URL.test(s)) throw new Error('not base64url')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** A random 128-bit link id: unguessable, so links cannot be enumerated. */
export const newShareId = () => toB64Url(crypto.getRandomValues(new Uint8Array(16)))

export async function exportShareKey(key: CryptoKey): Promise<string> {
  return toB64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export async function importShareKey(text: string): Promise<CryptoKey> {
  if (text.length !== KEY_CHARS) throw new Error('bad share key')
  const raw = fromB64Url(text)
  if (raw.length !== 32) throw new Error('bad share key')
  return importRawShareKey(raw)
}

export const buildShareUrl = (origin: string, shareId: string, key: string) => `${origin.replace(/\/+$/, '')}/s/${shareId}#${key}`

/** `{ shareId, key }` for a share link, or null for anything else (including a share path with no key). */
export function parseShareUrl(url: URL): { shareId: string; key: string } | null {
  const m = /^\/s\/([^/]+)$/.exec(url.pathname)
  if (!m || !SHARE_ID.test(m[1])) return null
  const key = url.hash.replace(/^#/, '')
  if (!key) return null
  return { shareId: m[1], key }
}
