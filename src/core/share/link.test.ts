import { describe, expect, it } from 'vitest'
import { generateShareKey } from '@/core/sync-engine/doc-crypto'
import { buildShareUrl, exportShareKey, importShareKey, newShareId, parseShareUrl } from './link'

describe('share links', () => {
  it('share ids are 128-bit random, URL-safe and distinct', () => {
    const ids = new Set(Array.from({ length: 200 }, newShareId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('builds /s/<id>#<key> and parses it back', async () => {
    const key = await generateShareKey()
    const k = await exportShareKey(key)
    expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const url = buildShareUrl('https://notes.example', 'AbC_-123456789012345678', k)
    expect(url).toBe(`https://notes.example/s/AbC_-123456789012345678#${k}`)
    expect(parseShareUrl(new URL(url))).toEqual({ shareId: 'AbC_-123456789012345678', key: k })
  })

  it('the key in the link imports back to the same key', async () => {
    const key = await generateShareKey()
    const back = await importShareKey(await exportShareKey(key))
    const raw = async (x: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', x)).join(',')
    expect(await raw(back)).toBe(await raw(key))
  })

  it('rejects links that are not share links or have a malformed key', async () => {
    expect(parseShareUrl(new URL('https://x/'))).toBeNull()
    expect(parseShareUrl(new URL('https://x/s/'))).toBeNull()
    expect(parseShareUrl(new URL('https://x/s/abc'))).toBeNull() // no key
    expect(parseShareUrl(new URL('https://x/s/a/b#k'))).toBeNull()
    expect(parseShareUrl(new URL('https://x/s/a%20b#k'))).toBeNull()
    expect(parseShareUrl(new URL('https://x/note/abc#k'))).toBeNull()
    await expect(importShareKey('short')).rejects.toThrow()
    await expect(importShareKey('!'.repeat(43))).rejects.toThrow()
  })
})
