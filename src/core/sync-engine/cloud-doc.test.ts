import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { SyncError } from '@/adapters/sync/types'
import { bindCloudDoc, pushInitialSnapshot, type CloudDocDeps } from './cloud-doc'

let sync: MemorySync
let kek: CryptoKey
beforeEach(async () => {
  sync = new MemorySync()
  kek = await generateKek()
})

const deps = (overrides: Partial<CloudDocDeps> = {}): CloudDocDeps => ({
  sync,
  vaultId: 'v1',
  docId: 'n1',
  kek,
  deviceId: 'devA',
  ...overrides,
})

// WebCrypto's decrypt/encrypt calls resolve off a thread pool, not purely on the microtask queue, so a
// bare microtask flush can observe them mid-flight — a short real delay is needed, not just setTimeout(0).
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 20))

describe('bindCloudDoc', () => {
  it('pushes local edits to the cloud, encrypted', async () => {
    const doc = new Y.Doc()
    const binding = await bindCloudDoc(doc, deps())
    doc.getText('t').insert(0, 'hello')
    await binding.flush()

    const [raw] = await sync.pullDoc('v1', 'n1')
    expect(raw).toBeDefined()
    expect(new TextDecoder().decode(raw)).not.toContain('hello') // opaque ciphertext, not plaintext

    const check = new Y.Doc()
    await bindCloudDoc(check, deps({ docId: 'n1', deviceId: 'devB' }))
    expect(check.getText('t').toString()).toBe('hello')
  })

  it('applies what is already in the cloud on attach', async () => {
    const seed = new Y.Doc()
    seed.getText('t').insert(0, 'seeded')
    await pushInitialSnapshot(seed, deps())

    const doc = new Y.Doc()
    await bindCloudDoc(doc, deps())
    expect(doc.getText('t').toString()).toBe('seeded')
  })

  it('pulls another device\'s push after a realtime notification', async () => {
    const a = new Y.Doc()
    const bindingA = await bindCloudDoc(a, deps({ deviceId: 'devA' }))
    const b = new Y.Doc()
    await bindCloudDoc(b, deps({ deviceId: 'devB' }))

    a.getText('t').insert(0, 'from A')
    await bindingA.flush()
    await flushMicrotasks()

    expect(b.getText('t').toString()).toBe('from A')
  })

  it('does not re-push an update it just pulled from the cloud (no echo loop)', async () => {
    const a = new Y.Doc()
    const bindingA = await bindCloudDoc(a, deps({ deviceId: 'devA' }))
    const b = new Y.Doc()
    const bindingB = await bindCloudDoc(b, deps({ deviceId: 'devB' }))

    a.getText('t').insert(0, 'x')
    await bindingA.flush()
    await flushMicrotasks()
    expect(bindingB.hasPending()).toBe(false)

    const docsInCloud = await sync.listDocs('v1')
    expect(docsInCloud).toEqual(['n1'])
    // Only devA's one push happened — devB applying the pulled update never queued a push of its own.
    const chunks = await sync.pullDoc('v1', 'n1')
    expect(chunks).toHaveLength(1)
  })

  it('skips pulling its own echoed push (self-notifications are filtered by deviceId)', async () => {
    const doc = new Y.Doc()
    let pulls = 0
    const realPullDoc = sync.pullDoc.bind(sync)
    sync.pullDoc = (...args) => {
      pulls++
      return realPullDoc(...args)
    }
    const binding = await bindCloudDoc(doc, deps({ deviceId: 'devA' }))
    pulls = 0 // ignore the initial pull on attach
    doc.getText('t').insert(0, 'x')
    await binding.flush()
    await flushMicrotasks()
    expect(pulls).toBe(0) // pushUpdate's own notification carries deviceId: 'devA', filtered out
  })

  it('retries a failed push with backoff and flush() waits for it to land', async () => {
    let shouldFail = true
    const realPushUpdate = sync.pushUpdate.bind(sync)
    const failing = Object.assign(Object.create(Object.getPrototypeOf(sync)), sync, {
      pushUpdate: (...args: Parameters<typeof realPushUpdate>) =>
        shouldFail ? Promise.reject(new SyncError('offline')) : realPushUpdate(...args),
    })
    const onError = vi.fn()
    const doc = new Y.Doc()
    const binding = await bindCloudDoc(doc, deps({ sync: failing, onError }))
    doc.getText('t').insert(0, 'x') // its own onUpdate listener already triggers one flush() attempt
    await flushMicrotasks() // let that one attempt fail and schedule a backoff retry, then stop
    expect(onError).toHaveBeenCalledTimes(1)
    expect(binding.isFailing()).toBe(true)
    expect(binding.hasPending()).toBe(true)

    shouldFail = false
    binding.retry() // cancels the scheduled backoff timer and retries now instead of waiting for it
    await binding.flush()
    expect(binding.hasPending()).toBe(false)
    expect(binding.isFailing()).toBe(false)
    expect((await sync.pullDoc('v1', 'n1')).length).toBe(1)
  })

  it('close() stops pushing, pulling, and drops unsent updates', async () => {
    const doc = new Y.Doc()
    const binding = await bindCloudDoc(doc, deps())
    await binding.close()
    doc.getText('t').insert(0, 'after close')
    await flushMicrotasks()
    expect(await sync.listDocs('v1')).toEqual([])
  })

  it('destroy() detaches listeners but lets already-queued pushes finish', async () => {
    const doc = new Y.Doc()
    const binding = await bindCloudDoc(doc, deps())
    doc.getText('t').insert(0, 'x')
    binding.destroy()
    await binding.flush()
    expect((await sync.pullDoc('v1', 'n1')).length).toBe(1)
  })
})

describe('pushInitialSnapshot', () => {
  it('uploads the whole current doc state as a snapshot at seq 0', async () => {
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'initial')
    await pushInitialSnapshot(doc, deps())
    const chunks = await sync.pullDoc('v1', 'n1')
    expect(chunks).toHaveLength(1)
  })
})
