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

// ---- share-link passwords (phase 4b) ----
// A protected link needs both the link (its key after `#`) and the password. The two are mixed with HKDF into
// a content key (encrypts the snapshot) and a proof (the server keeps only SHA-256 of it and hands out the
// ciphertext only for the right proof). Without the link's key, a leaked database cannot be used to guess the
// password; without the password, the link alone gets no ciphertext.
// The owner keeps the PBKDF2 output (`pwBits`) wrapped under the KEK, so updating the snapshot, renewing the
// link or removing the password never needs the old password — and the password itself is stored nowhere.

const sharePwInfo = (kind: 'content' | 'proof', shareId: string) => te.encode(`notes-v2|share-pw|v1|${kind}|${shareId}`)
/** Binds a wrapped `pwBits` to its vault and link. */
export const sharePwKeyAad = (vaultId: string, shareId: string) => te.encode(`notes-v2|share-pw-key|v1|${vaultId}|${shareId}`)

/** The content key and server proof of a protected link. `pwBits` is the PBKDF2 output of the password. */
export async function deriveSharePasswordSecrets(
  linkKey: CryptoKey,
  shareId: string,
  pwBits: Uint8Array,
): Promise<{ contentKey: CryptoKey; proof: Uint8Array }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', linkKey))
  const ikm = new Uint8Array(raw.length + pwBits.length)
  ikm.set(raw, 0)
  ikm.set(pwBits, raw.length)
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const hkdf = (kind: 'content' | 'proof'): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: sharePwInfo(kind, shareId) })
  const contentKey = await crypto.subtle.deriveKey(hkdf('content'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const proof = new Uint8Array(await crypto.subtle.deriveBits(hkdf('proof'), base, 256))
  return { contentKey, proof }
}

/** What the server stores to check a proof: SHA-256 of it (a leaked database row cannot be replayed). */
export const shareProofVerifier = async (proof: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', proof as Uint8Array<ArrayBuffer>))

export const wrapSharePwBits = (kek: CryptoKey, vaultId: string, shareId: string, pwBits: Uint8Array) =>
  encrypt(kek, pwBits, sharePwKeyAad(vaultId, shareId))

export const unwrapSharePwBits = (kek: CryptoKey, vaultId: string, shareId: string, wrapped: Uint8Array) =>
  decrypt(kek, wrapped, sharePwKeyAad(vaultId, shareId))

// ---- share-link attachments (phase 4d) ----
// Every shared file has its own random key, kept only inside the (encrypted) snapshot; the stored object is bound
// to its random object name. So: a protected link's files cannot be opened without the password (their keys are in
// the snapshot), changing the password or renewing the link never re-encrypts them, and the server cannot serve
// one file in place of another (another name, another key).

export const shareFileAad = (objectName: string) => te.encode(`notes-v2|share-blob|v1|${objectName}`)
const shareRefInfo = (attachmentId: string) => te.encode(`notes-v2|share-ref|v1|${attachmentId}`)

const importShareFileKey = (raw: Uint8Array) =>
  crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

export const encryptShareFile = async (rawKey: Uint8Array, objectName: string, bytes: Uint8Array) =>
  encrypt(await importShareFileKey(rawKey), bytes, shareFileAad(objectName))

/** Throws `CryptoError` for a wrong key or an object that is not `objectName`. */
export const decryptShareFile = async (rawKey: Uint8Array, objectName: string, ciphertext: Uint8Array) =>
  decrypt(await importShareFileKey(rawKey), ciphertext, shareFileAad(objectName))

/**
 * Lets the owner recognise which of its attachments a shared file is (to reuse the upload when the snapshot is
 * updated) without the real attachment id leaving the device: HMAC-SHA256 keyed with that file's own key.
 */
export async function shareFileRef(rawKey: Uint8Array, attachmentId: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', rawKey as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, shareRefInfo(attachmentId)))
}
