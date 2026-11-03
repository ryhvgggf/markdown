import { decrypt, encrypt } from '@/adapters/crypto/webcrypto-crypto'

/**
 * The only way content should be encrypted for the cloud: every ciphertext is bound (AES-GCM additional
 * authenticated data) to where it belongs — its vault and its doc or attachment id. The server stores these
 * blobs and could otherwise swap them around (serve note A's ciphertext as note B, or an attachment as a
 * note); with the binding, decrypting a blob anywhere but its own slot fails instead of showing the wrong data.
 *
 * The `v1` tag versions the binding format itself, so it can change later without ambiguity.
 */
const te = new TextEncoder()

export const docAad = (vaultId: string, docId: string) => te.encode(`notes-v2|doc|v1|${vaultId}|${docId}`)
export const attachmentAad = (vaultId: string, attachmentId: string) =>
  te.encode(`notes-v2|attachment|v1|${vaultId}|${attachmentId}`)

/** Encrypts one doc chunk (Yjs update or snapshot) for `(vaultId, docId)`. */
export const encryptDocChunk = (kek: CryptoKey, vaultId: string, docId: string, bytes: Uint8Array) =>
  encrypt(kek, bytes, docAad(vaultId, docId))

/** Inverse of `encryptDocChunk`; throws `CryptoError` if the chunk belongs to another doc or vault. */
export const decryptDocChunk = (kek: CryptoKey, vaultId: string, docId: string, ciphertext: Uint8Array) =>
  decrypt(kek, ciphertext, docAad(vaultId, docId))

export const encryptAttachment = (kek: CryptoKey, vaultId: string, attachmentId: string, bytes: Uint8Array) =>
  encrypt(kek, bytes, attachmentAad(vaultId, attachmentId))

export const decryptAttachment = (kek: CryptoKey, vaultId: string, attachmentId: string, ciphertext: Uint8Array) =>
  decrypt(kek, ciphertext, attachmentAad(vaultId, attachmentId))

// ---- share links (phase 4a) ----
// Each link has its own random share key, unrelated to the KEK: a leaked link exposes only that one snapshot.
// The key travels after `#` in the link (never sent to a server); the cloud keeps it only wrapped under the KEK.

/** Binds a snapshot to its link id, so the server cannot serve link A's content under link B. */
export const shareAad = (shareId: string) => te.encode(`notes-v2|share|v1|${shareId}`)
/** Binds a wrapped share key to its vault and link. */
export const shareKeyAad = (vaultId: string, shareId: string) => te.encode(`notes-v2|share-key|v1|${vaultId}|${shareId}`)

/** A fresh AES-256-GCM share key. Extractable: it has to go into the link. */
export const generateShareKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

export const encryptShareSnapshot = (shareKey: CryptoKey, shareId: string, bytes: Uint8Array) =>
  encrypt(shareKey, bytes, shareAad(shareId))

/** Throws `CryptoError` on a wrong key or a snapshot that belongs to another link. */
export const decryptShareSnapshot = (shareKey: CryptoKey, shareId: string, ciphertext: Uint8Array) =>
  decrypt(shareKey, ciphertext, shareAad(shareId))

export async function wrapShareKey(kek: CryptoKey, vaultId: string, shareId: string, shareKey: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', shareKey))
  return encrypt(kek, raw, shareKeyAad(vaultId, shareId))
}

export async function unwrapShareKey(kek: CryptoKey, vaultId: string, shareId: string, wrapped: Uint8Array): Promise<CryptoKey> {
  const raw = await decrypt(kek, wrapped, shareKeyAad(vaultId, shareId))
  return importRawShareKey(raw)
}

/** Imports 32 raw bytes as a share key (extractable, so "copy link" can put it back into a link). */
export const importRawShareKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
