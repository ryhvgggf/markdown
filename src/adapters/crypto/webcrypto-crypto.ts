import { type KdfParams, toCryptoError } from './types'

/**
 * WebCrypto implementation of the crypto adapter. AES-256-GCM for both content encryption and key
 * wrapping (wrapping is just "export the key, encrypt the raw bytes" — one primitive, not two), PBKDF2
 * for deriving a wrapping key from a password or recovery code. See types.ts for the rationale and the
 * design doc this implements.
 */

const AES_ALGO = 'AES-GCM'
const AES_LENGTH = 256
const IV_BYTES = 12
const DEFAULT_PBKDF2_ITERATIONS = 600_000

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

// TS 5.7 narrowed the ambient `Uint8Array` type to `Uint8Array<ArrayBufferLike>`, which WebCrypto's
// `BufferSource` overloads reject (they want a concrete `ArrayBuffer`, not a `SharedArrayBuffer`). Every
// array in this file comes from `new Uint8Array(n)`, `.subarray()` of one, or a `CryptoKey` export, so it's
// always backed by a plain ArrayBuffer — this cast just tells TS what's already true.
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** A fresh, random knowledge-base master key (KEK). Extractable: it must be wrappable. */
export async function generateKek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_ALGO, length: AES_LENGTH }, true, ['encrypt', 'decrypt'])
}

/**
 * Derives a wrapping key from a low-entropy secret (password or recovery code). Pass `params` from a
 * previous call to re-derive the same key (e.g. on login); omit it to generate a fresh salt (e.g. on
 * sign-up). Not extractable — this key is only ever used to wrap/unwrap the KEK, never exported.
 */
export async function deriveKeyFromSecret(
  secret: string,
  params?: KdfParams,
): Promise<{ key: CryptoKey; params: KdfParams }> {
  const iterations = params?.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  const salt = params ? fromB64(params.saltB64) : randomBytes(16)
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations, hash: 'SHA-256' },
    material,
    { name: AES_ALGO, length: AES_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
  return { key, params: { algorithm: 'PBKDF2-SHA256', saltB64: toB64(salt), iterations } }
}

function gcmParams(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  return aad ? { name: AES_ALGO, iv: buf(iv), additionalData: buf(aad) } : { name: AES_ALGO, iv: buf(iv) }
}

/**
 * AES-GCM encrypt with a fresh random IV each call. Output is `iv || ciphertext`. `aad` (additional
 * authenticated data) binds the ciphertext to a context without encrypting it: decrypting with a different
 * `aad` fails, so a server can't move one doc's ciphertext into another doc's slot (see core/sync-engine/doc-crypto).
 */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES)
  try {
    const ct = new Uint8Array(await crypto.subtle.encrypt(gcmParams(iv, aad), key, buf(plaintext)))
    const out = new Uint8Array(iv.length + ct.length)
    out.set(iv, 0)
    out.set(ct, iv.length)
    return out
  } catch (e) {
    throw toCryptoError(e)
  }
}

/** Inverse of `encrypt`. Throws `CryptoError('invalid-key', ...)` on a wrong key, a different `aad`, or corrupted input. */
export async function decrypt(key: CryptoKey, payload: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  if (payload.length < IV_BYTES) throw toCryptoError({ name: 'OperationError' })
  const iv = payload.subarray(0, IV_BYTES)
  const ct = payload.subarray(IV_BYTES)
  try {
    return new Uint8Array(await crypto.subtle.decrypt(gcmParams(iv, aad), key, buf(ct)))
  } catch (e) {
    throw toCryptoError(e)
  }
}

/** Wraps a KEK under `wrappingKey` (a password- or recovery-code-derived key). */
export async function wrapKey(kek: CryptoKey, wrappingKey: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kek))
  return encrypt(wrappingKey, raw)
}

/** Inverse of `wrapKey`. Throws `CryptoError('invalid-key', ...)` if `wrappingKey` is wrong. */
export async function unwrapKey(wrapped: Uint8Array, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const raw = await decrypt(wrappingKey, wrapped)
  return crypto.subtle.importKey('raw', buf(raw), { name: AES_ALGO, length: AES_LENGTH }, true, [
    'encrypt',
    'decrypt',
  ])
}
