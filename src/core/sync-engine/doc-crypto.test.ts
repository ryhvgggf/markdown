import { describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { CryptoError } from '@/adapters/crypto/types'
import {
  decryptShareSnapshot,
  encryptDocChunk,
  encryptShareSnapshot,
  generateShareKey,
  unwrapShareKey,
  wrapShareKey,
} from './doc-crypto'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe('share encryption', () => {
  it('round-trips a snapshot under its own share id', async () => {
    const key = await generateShareKey()
    const ct = await encryptShareSnapshot(key, 's1', bytes('hello'))
    expect(text(await decryptShareSnapshot(key, 's1', ct))).toBe('hello')
  })

  it('a snapshot served under another share id does not decrypt', async () => {
    const key = await generateShareKey()
    const ct = await encryptShareSnapshot(key, 's1', bytes('hello'))
    await expect(decryptShareSnapshot(key, 's2', ct)).rejects.toBeInstanceOf(CryptoError)
  })

  it('a doc chunk encrypted with the same key is not accepted as a snapshot', async () => {
    const key = await generateShareKey()
    const ct = await encryptDocChunk(key, 'v1', 's1', bytes('hello'))
    await expect(decryptShareSnapshot(key, 's1', ct)).rejects.toBeInstanceOf(CryptoError)
  })

  it('wraps the share key under the KEK, bound to vault and share id', async () => {
    const kek = await generateKek()
    const key = await generateShareKey()
    const wrapped = await wrapShareKey(kek, 'v1', 's1', key)
    const back = await unwrapShareKey(kek, 'v1', 's1', wrapped)
    const ct = await encryptShareSnapshot(key, 's1', bytes('x'))
    expect(text(await decryptShareSnapshot(back, 's1', ct))).toBe('x')
    await expect(unwrapShareKey(kek, 'v1', 's2', wrapped)).rejects.toBeInstanceOf(CryptoError)
    await expect(unwrapShareKey(kek, 'v2', 's1', wrapped)).rejects.toBeInstanceOf(CryptoError)
    await expect(unwrapShareKey(await generateKek(), 'v1', 's1', wrapped)).rejects.toBeInstanceOf(CryptoError)
  })

  it('every share key is different from the KEK and from other share keys', async () => {
    const raw = async (k: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', k)).join(',')
    const [a, b] = [await generateShareKey(), await generateShareKey()]
    expect(await raw(a)).not.toBe(await raw(b))
  })
})
