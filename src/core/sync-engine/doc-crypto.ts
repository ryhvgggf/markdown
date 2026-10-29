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
