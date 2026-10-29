import { describe, expect, it } from 'vitest'
import { CryptoError } from './types'
import { decrypt, deriveKeyFromSecret, encrypt, fromB64, generateKek, toB64, unwrapKey, wrapKey } from './webcrypto-crypto'

// jsdom's `Uint8Array` and the one WebCrypto results are built from come from different realms, so chai's
// toEqual sees "different" constructors on byte-identical arrays (vitest prints "no visual difference").
// Compare as plain arrays to sidestep that — it's an environment quirk, not something the adapter controls.
const bytesEqual = (a: Uint8Array, b: Uint8Array) => expect(Array.from(a)).toEqual(Array.from(b))

describe('encrypt/decrypt', () => {
  it('round-trips plaintext', async () => {
    const key = await generateKek()
    const plaintext = new TextEncoder().encode('筆記 v2 測試內容')
    const ciphertext = await encrypt(key, plaintext)
    bytesEqual(await decrypt(key, ciphertext), plaintext)
  })

  it('uses a fresh IV each call, so identical plaintext encrypts differently', async () => {
    const key = await generateKek()
    const plaintext = new TextEncoder().encode('same content')
    const a = await encrypt(key, plaintext)
    const b = await encrypt(key, plaintext)
    expect(toB64(a)).not.toEqual(toB64(b))
  })

  it('throws CryptoError(invalid-key) when decrypting with the wrong key', async () => {
    const key = await generateKek()
    const other = await generateKek()
    const ciphertext = await encrypt(key, new TextEncoder().encode('secret'))
    await expect(decrypt(other, ciphertext)).rejects.toMatchObject({ kind: 'invalid-key' })
  })

  it('throws CryptoError(invalid-key) on truncated/corrupted ciphertext', async () => {
    const key = await generateKek()
    const ciphertext = await encrypt(key, new TextEncoder().encode('secret'))
    const corrupted = ciphertext.slice(0, -1)
    await expect(decrypt(key, corrupted)).rejects.toBeInstanceOf(CryptoError)
  })
})

describe('deriveKeyFromSecret', () => {
  it('re-derives the same key given the same secret and params', async () => {
    const a = await deriveKeyFromSecret('correct horse battery staple')
    const b = await deriveKeyFromSecret('correct horse battery staple', a.params)
    // same derived key => can decrypt what the other encrypted
    const ciphertext = await encrypt(a.key, new TextEncoder().encode('x'))
    bytesEqual(await decrypt(b.key, ciphertext), new TextEncoder().encode('x'))
  })

  it('derives a different key for a different secret even with the same salt/iterations', async () => {
    const a = await deriveKeyFromSecret('password-one')
    const b = await deriveKeyFromSecret('password-two', a.params)
    const ciphertext = await encrypt(a.key, new TextEncoder().encode('x'))
    await expect(decrypt(b.key, ciphertext)).rejects.toMatchObject({ kind: 'invalid-key' })
  })

  it('uses a fresh random salt when none is given', async () => {
    const a = await deriveKeyFromSecret('same password')
    const b = await deriveKeyFromSecret('same password')
    expect(a.params.saltB64).not.toEqual(b.params.saltB64)
  })
})

describe('wrapKey/unwrapKey', () => {
  it('round-trips a KEK through wrap/unwrap, recovering a working key', async () => {
    const kek = await generateKek()
    const { key: wrappingKey } = await deriveKeyFromSecret('my-password')
    const wrapped = await wrapKey(kek, wrappingKey)
    const recovered = await unwrapKey(wrapped, wrappingKey)

    const plaintext = new TextEncoder().encode('knowledge base contents')
    const ciphertext = await encrypt(kek, plaintext)
    bytesEqual(await decrypt(recovered, ciphertext), plaintext)
  })

  it('mirrors the design doc: password-wrapped and recovery-wrapped copies both unwrap to the same KEK', async () => {
    const kek = await generateKek()
    const { key: pwKey } = await deriveKeyFromSecret('my-password')
    const { key: recoveryKey } = await deriveKeyFromSecret('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX')
    const wrappedByPassword = await wrapKey(kek, pwKey)
    const wrappedByRecovery = await wrapKey(kek, recoveryKey)

    const fromPassword = await unwrapKey(wrappedByPassword, pwKey)
    const fromRecovery = await unwrapKey(wrappedByRecovery, recoveryKey)

    const plaintext = new TextEncoder().encode('same vault')
    const ciphertext = await encrypt(fromPassword, plaintext)
    bytesEqual(await decrypt(fromRecovery, ciphertext), plaintext)
  })

  it('fails to unwrap with the wrong wrapping key', async () => {
    const kek = await generateKek()
    const { key: wrappingKey } = await deriveKeyFromSecret('correct password')
    const { key: wrongKey } = await deriveKeyFromSecret('wrong password')
    const wrapped = await wrapKey(kek, wrappingKey)
    await expect(unwrapKey(wrapped, wrongKey)).rejects.toMatchObject({ kind: 'invalid-key' })
  })
})

describe('toB64/fromB64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(100))
    expect(fromB64(toB64(bytes))).toEqual(bytes)
  })
})
