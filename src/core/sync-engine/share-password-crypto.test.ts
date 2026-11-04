import { describe, expect, it } from 'vitest'
import { deriveBitsFromSecret, generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { CryptoError } from '@/adapters/crypto/types'
import {
  decryptShareSnapshot,
  deriveSharePasswordSecrets,
  encryptShareSnapshot,
  generateShareKey,
  shareProofVerifier,
  unwrapSharePwBits,
  wrapSharePwBits,
} from './doc-crypto'

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const bits = (n: number) => new Uint8Array(32).fill(n)

describe('share-link password crypto (phase 4b)', () => {
  it('the same link key, link id and password give the same content key and proof', async () => {
    const link = await generateShareKey()
    const a = await deriveSharePasswordSecrets(link, 's1', bits(1))
    const b = await deriveSharePasswordSecrets(link, 's1', bits(1))
    expect(hex(a.proof)).toBe(hex(b.proof))
    const ct = await encryptShareSnapshot(a.contentKey, 's1', new Uint8Array([7]))
    expect(await decryptShareSnapshot(b.contentKey, 's1', ct)).toEqual(new Uint8Array([7]))
  })

  it('needs both the link key and the password: changing either changes both secrets', async () => {
    const link = await generateShareKey()
    const base = await deriveSharePasswordSecrets(link, 's1', bits(1))
    const ct = await encryptShareSnapshot(base.contentKey, 's1', new Uint8Array([7]))
    for (const other of [
      await deriveSharePasswordSecrets(link, 's1', bits(2)),
      await deriveSharePasswordSecrets(await generateShareKey(), 's1', bits(1)),
      await deriveSharePasswordSecrets(link, 's2', bits(1)),
    ]) {
      expect(hex(other.proof)).not.toBe(hex(base.proof))
      await expect(decryptShareSnapshot(other.contentKey, 's1', ct)).rejects.toBeInstanceOf(CryptoError)
    }
    // nor does the link key alone open it
    await expect(decryptShareSnapshot(link, 's1', ct)).rejects.toBeInstanceOf(CryptoError)
  })

  it('the proof is not the content key, and the server-side verifier is its SHA-256', async () => {
    const link = await generateShareKey()
    const { proof } = await deriveSharePasswordSecrets(link, 's1', bits(1))
    const v = await shareProofVerifier(proof)
    expect(v).toHaveLength(32)
    expect(hex(v)).not.toBe(hex(proof))
    expect(hex(v)).toBe(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', proof as Uint8Array<ArrayBuffer>))))
  })

  it('the password bytes are wrapped under the KEK, bound to vault and link', async () => {
    const kek = await generateKek()
    const w = await wrapSharePwBits(kek, 'v1', 's1', bits(3))
    expect(await unwrapSharePwBits(kek, 'v1', 's1', w)).toEqual(bits(3))
    await expect(unwrapSharePwBits(kek, 'v1', 's2', w)).rejects.toBeInstanceOf(CryptoError)
    await expect(unwrapSharePwBits(kek, 'v2', 's1', w)).rejects.toBeInstanceOf(CryptoError)
  })

  it('password bytes: same password and salt give the same bytes; NFC and NFD spellings match', async () => {
    const first = await deriveBitsFromSecret('café密碼', { algorithm: 'PBKDF2-SHA256', saltB64: btoa('0123456789abcdef'), iterations: 1000 })
    const nfd = await deriveBitsFromSecret('café密碼'.normalize('NFD'), first.params)
    expect(first.bits).toHaveLength(32)
    expect(hex(nfd.bits)).toBe(hex(first.bits))
    const other = await deriveBitsFromSecret('cafe密碼', first.params)
    expect(hex(other.bits)).not.toBe(hex(first.bits))
    const fresh = await deriveBitsFromSecret('x')
    expect(fresh.params.iterations).toBe(600_000)
  })
})
