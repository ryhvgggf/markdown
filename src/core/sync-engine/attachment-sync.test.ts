import { beforeEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { pullAttachment, pushAttachment } from './attachment-sync'

let sync: MemoryAttachmentSync
beforeEach(() => {
  sync = new MemoryAttachmentSync()
})

describe('attachment sync', () => {
  it('round-trips an attachment, encrypted', async () => {
    const kek = await generateKek()
    const bytes = new TextEncoder().encode('fake image bytes')
    await pushAttachment(sync, kek, 'v1', 'n1', 'a1', bytes)

    const pulled = await pullAttachment(sync, kek, 'v1', 'a1')
    // WebCrypto's result comes from a different realm than jsdom's Uint8Array, so compare byte arrays
    // rather than relying on toEqual across realms (see webcrypto-crypto.test.ts for the same pattern).
    expect(Array.from(pulled!)).toEqual(Array.from(bytes))

    // what actually landed in storage is opaque ciphertext, not the plaintext
    const raw = await sync.downloadAttachment('v1', 'a1')
    expect(new TextDecoder().decode(raw!)).not.toContain('fake image bytes')
  })

  it('returns null when nothing was uploaded', async () => {
    const kek = await generateKek()
    expect(await pullAttachment(sync, kek, 'v1', 'ghost')).toBeNull()
  })

  it('fails to decrypt with the wrong key', async () => {
    const kek = await generateKek()
    const wrongKek = await generateKek()
    await pushAttachment(sync, kek, 'v1', 'n1', 'a1', new TextEncoder().encode('x'))
    await expect(pullAttachment(sync, wrongKek, 'v1', 'a1')).rejects.toMatchObject({ kind: 'invalid-key' })
  })

  it('rejects ciphertext moved into another attachment slot (server swap)', async () => {
    const kek = await generateKek()
    await pushAttachment(sync, kek, 'v1', 'n1', 'a1', new TextEncoder().encode('one'))
    await pushAttachment(sync, kek, 'v1', 'n1', 'a2', new TextEncoder().encode('two'))
    // a malicious server serves a1's blob when a2 is requested
    await sync.uploadAttachment('v1', 'n1', 'a2', (await sync.downloadAttachment('v1', 'a1'))!)
    await expect(pullAttachment(sync, kek, 'v1', 'a2')).rejects.toMatchObject({ kind: 'invalid-key' })
  })
})
