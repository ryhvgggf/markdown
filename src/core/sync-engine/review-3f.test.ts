import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import type { RemoteChange, SyncAdapter } from '@/adapters/sync/types'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { manifestDocId, pullManifest } from './manifest-sync'
import { createSyncManager, type SyncManager } from './sync-manager'

// 3f focused review: each test describes a scenario the existing suites don't cover. They are written to
// FAIL on d05ef64 — each failure is a finding, not a broken test.

const isolated = () =>
  ({ postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} }) as unknown as BroadcastChannel
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out')
    await wait(20)
  }
}

/** One device's view of the shared cloud, with switches for a flaky manifest read and missed realtime events. */
class DeviceSync implements SyncAdapter {
  failManifestPull = false
  deaf = false
  failPushes = false
  slowPull: Promise<void> | null = null // note pulls (not the manifest) wait for this
  constructor(private cloud: MemorySync) {}
  async pushUpdate(...a: Parameters<SyncAdapter['pushUpdate']>) {
    if (this.failPushes) throw new Error('offline')
    return this.cloud.pushUpdate(...a)
  }
  pushSnapshot(...a: Parameters<SyncAdapter['pushSnapshot']>) { return this.cloud.pushSnapshot(...a) }
  deleteDoc(...a: Parameters<SyncAdapter['deleteDoc']>) { return this.cloud.deleteDoc(...a) }
  listDocs(...a: Parameters<SyncAdapter['listDocs']>) { return this.cloud.listDocs(...a) }
  async pullDoc(vaultId: string, docId: string) {
    if (this.failManifestPull && docId === manifestDocId(vaultId)) throw new Error('network blip')
    if (this.slowPull && docId !== manifestDocId(vaultId)) await this.slowPull
    return this.cloud.pullDoc(vaultId, docId)
  }
  subscribe(vaultId: string, cb: (c: RemoteChange) => void) {
    return this.cloud.subscribe(vaultId, (c) => {
      if (!this.deaf) cb(c)
    })
  }
}

interface Device { vault: Vault; notes: NoteDocCache; manager: SyncManager; sync: DeviceSync }
let cloud: MemorySync
let kek: CryptoKey
const devices: Device[] = []

async function device(name: string): Promise<Device> {
  const storage = new MemoryStorage()
  const vault = await Vault.open(storage, 'v1', { channelFactory: isolated })
  const notes = new NoteDocCache(storage, { channelFactory: isolated })
  const sync = new DeviceSync(cloud)
  const manager = createSyncManager({
    sync, attachmentSync: new MemoryAttachmentSync(), storage, noteDocs: notes, vault, vaultId: 'v1', kek, deviceId: name,
  })
  const d = { vault, notes, manager, sync }
  devices.push(d)
  return d
}
const para = (t: string) => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(t)])
  return p
}
async function write(d: Device, id: string, ...lines: string[]) {
  const doc = await d.notes.acquire(id)
  const f = doc.getXmlFragment('content')
  f.insert(f.length, lines.map(para))
  d.notes.release(id)
}
async function lines(d: Device, id: string) {
  const doc = await d.notes.acquire(id)
  const out = doc.getXmlFragment('content').toArray().map((n) => (n as Y.XmlElement).toString().replace(/<[^>]+>/g, ''))
  d.notes.release(id)
  return out
}
const settled = (...ds: Device[]) => until(() => ds.every((d) => !d.manager.hasPending()))

beforeEach(async () => {
  cloud = new MemorySync()
  kek = await generateKek()
})
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.manager.close()
    d.vault.close()
  }
})

describe('3f review', () => {
  it('B1 [丟資料／誤開關] a manifest read that fails right before a push must not overwrite the cloud manifest with only this device\'s notes', async () => {
    const a = await device('A')
    const x = a.vault.createNote({ title: 'X on A' })
    const y = a.vault.createNote({ title: 'Y removed' })
    a.vault.setNoteSynced(x.id, true)
    a.vault.setNoteSynced(y.id, true)
    await a.manager.start()
    await settled(a)
    a.vault.setNoteSynced(y.id, false) // leaves a removal mark for Y
    await until(async () => ((await pullManifest(cloud, kek, 'v1'))?.removed ?? []).length === 1)
    await settled(a)
    await a.manager.close()

    const b = await device('B')
    const z = b.vault.createNote({ title: 'Z on B' })
    b.vault.setNoteSynced(z.id, true)
    b.sync.failManifestPull = true // reading the manifest fails (timeout), writing works
    await b.manager.start()
    await wait(300)

    const before = await pullManifest(cloud, kek, 'v1') // still A's: nothing was overwritten while B couldn't read
    expect(before?.notes.map((n) => n.title)).toEqual(['X on A'])
    expect(before?.removed?.map((r) => r.id)).toEqual([y.id])

    b.sync.failManifestPull = false // reads work again (back online): B's note is added to the cloud's list
    window.dispatchEvent(new Event('online'))
    await settled(b)
    const m = await pullManifest(cloud, kek, 'v1')
    expect(m?.notes.map((n) => n.title).sort()).toEqual(['X on A', 'Z on B'])
    expect(m?.removed?.map((r) => r.id)).toEqual([y.id])
  })

  it('B2 [丟資料] the newer local copy is kept when the manifest cannot be read at the moment of comparing', async () => {
    const a = await device('A')
    a.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 100 })
    await write(a, 'n', 'old text on A')
    a.vault.setNoteSynced('n', true)
    await a.manager.start()
    await settled(a)

    const b = await device('B') // same note imported separately, edited much later
    b.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 900 })
    await write(b, 'n', 'newer text on B')
    b.vault.setNoteSynced('n', true)
    b.sync.failManifestPull = true
    await b.manager.start()
    await wait(300)

    expect(await lines(b, 'n')).toEqual(['newer text on B'])
  })

  it('B3 [丟資料] a device that missed the "cloud replaced" event does not lose the edits it makes afterwards', async () => {
    const a = await device('A')
    a.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 100 })
    await write(a, 'n', 'shared')
    a.vault.setNoteSynced('n', true)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(async () => b.vault.getNote('n')?.synced === true && (await lines(b, 'n')).includes('shared'))
    await settled(a, b)

    await a.manager.close() // A is not around for what follows (only B and C)
    b.sync.deaf = true // laptop asleep: realtime events are missed and never replayed
    const c = await device('C') // separately imported copy, newer → replaces the cloud copy
    c.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 500 })
    await write(c, 'n', 'C replaced')
    c.vault.setNoteSynced('n', true)
    await c.manager.start()
    await settled(c)
    b.sync.deaf = false // awake again; nothing re-pulls

    await write(b, 'n', 'B wrote this after waking') // the newest edit anywhere
    await settled(b)
    await write(c, 'n', 'C again') // any later edit triggers B's pull
    await settled(b, c)
    await wait(200)

    expect(await lines(b, 'n')).toContain('B wrote this after waking')
    expect(await lines(c, 'n')).toEqual(await lines(b, 'n')) // the devices show the same note
  })

  it('C1 [誤開關] turning a note off while signed out is not undone at the next sign-in', async () => {
    const a = await device('A')
    const f = a.vault.createFolder({ name: 'F', parentId: null })
    const n = a.vault.createNote({ title: 'N', folderId: f.id })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => b.vault.getNote(n.id)?.synced === true)
    await settled(a, b)
    await b.manager.close() // signed out (session expired)

    b.vault.setNoteSynced(n.id, false) // sync off while nothing is running
    expect(b.vault.getNote(n.id)?.synced).toBe(false)

    const b2 = createSyncManager({
      sync: b.sync, attachmentSync: new MemoryAttachmentSync(), storage: new MemoryStorage(), noteDocs: b.notes,
      vault: b.vault, vaultId: 'v1', kek, deviceId: 'B',
    })
    devices.push({ ...b, manager: b2 })
    await b2.start() // signed in again
    await wait(300)
    expect(b.vault.getNote(n.id)?.synced).toBe(false)
  })

  it('C3 [誤開關] sync turned off right before the app closed: after the restart the cloud copy is removed, not switched back on', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'N' })
    await write(a, n.id, 'text')
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    await settled(a)
    await a.manager.close() // the app closes…
    a.vault.setNoteSynced(n.id, false) // …right as sync is turned off: no removal was recorded

    const restarted = createSyncManager({
      sync: a.sync, attachmentSync: new MemoryAttachmentSync(), storage: new MemoryStorage(), noteDocs: a.notes,
      vault: a.vault, vaultId: 'v1', kek, deviceId: 'A',
    })
    devices.push({ ...a, manager: restarted })
    await restarted.start()
    await until(async () => ((await pullManifest(cloud, kek, 'v1'))?.removed ?? []).some((r) => r.id === n.id))
    expect(a.vault.getNote(n.id)?.synced).toBe(false)
    expect(await cloud.pullDoc('v1', n.id)).toEqual([])
    expect((await pullManifest(cloud, kek, 'v1'))?.notes.map((x) => x.id)).not.toContain(n.id)
  })

  it('C1 [誤開關] a note turned off while signed out still follows the account when another device turned it on later', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'N' })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => b.vault.getNote(n.id)?.synced === true)
    await settled(a, b)
    await b.manager.close()
    b.vault.setNoteSynced(n.id, false) // signed out on B: turned off there…
    await wait(5)
    a.vault.setNoteSynced(n.id, false) // …then on A off and on again, later
    await settled(a)
    a.vault.setNoteSynced(n.id, true)
    await settled(a)

    const b2 = createSyncManager({
      sync: b.sync, attachmentSync: new MemoryAttachmentSync(), storage: new MemoryStorage(), noteDocs: b.notes,
      vault: b.vault, vaultId: 'v1', kek, deviceId: 'B',
    })
    devices.push({ ...b, manager: b2 })
    await b2.start()
    await until(() => b.vault.getNote(n.id)?.synced === true) // the later choice (on, on A) wins
    await settled(a, b)
    expect(a.vault.getNote(n.id)?.synced).toBe(true)
  })

  it('B2 [丟資料] the cloud copy is there but the manifest does not list it yet: neither copy replaces the other until it does', async () => {
    const a = await device('A')
    a.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 100 })
    await write(a, 'n', 'old text on A')
    a.vault.setNoteSynced('n', true)
    await a.manager.start()
    await settled(a)
    await cloud.deleteDoc('v1', manifestDocId('v1')) // A's note is uploaded, its manifest entry not yet

    const b = await device('B')
    b.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 900 })
    await write(b, 'n', 'newer text on B')
    b.vault.setNoteSynced('n', true)
    await b.manager.start()
    await wait(200)
    expect(await lines(b, 'n')).toEqual(['newer text on B'])
  })

  it('[三級] a note turned on while a new device is still downloading is uploaded right away', async () => {
    const a = await device('A')
    const old = a.vault.createNote({ title: 'Old' })
    await write(a, old.id, 'x')
    a.vault.setNoteSynced(old.id, true)
    await a.manager.start()
    await settled(a)

    const b = await device('B')
    const fresh = b.vault.createNote({ title: 'Fresh' })
    await write(b, fresh.id, 'made on B')
    let release!: () => void
    b.sync.slowPull = new Promise<void>((r) => (release = r))
    const starting = b.manager.start()
    await until(() => b.manager.loadingNoteIds().length > 0)
    b.vault.setNoteSynced(fresh.id, true) // while the download is still running
    await until(async () => (await cloud.pullDoc('v1', fresh.id)).length > 0) // not waiting for the download
    release()
    await starting
  })

  it('[三級] back online: edits waiting to be pushed go at once, not after the backoff', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'N' })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    await settled(a)
    a.sync.failPushes = true
    await write(a, n.id, 'offline edit')
    await wait(100) // the push failed; next try is seconds away
    expect(a.manager.hasPending()).toBe(true)
    a.sync.failPushes = false
    window.dispatchEvent(new Event('online'))
    await until(() => !a.manager.hasPending(), 1000)
    const b = await device('B')
    await b.manager.start()
    await until(async () => (await lines(b, n.id)).includes('offline edit'))
  })

  it('B3 [丟資料] back online after missing the replacement: the device takes on the new cloud copy before anything else is written', async () => {
    const a = await device('A')
    a.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 100 })
    await write(a, 'n', 'shared')
    a.vault.setNoteSynced('n', true)
    await a.manager.start()
    await settled(a)
    a.sync.deaf = true // asleep
    const c = await device('C')
    c.vault.createNote({ id: 'n', title: 'Same', createdAt: 100, updatedAt: 500 })
    await write(c, 'n', 'C replaced')
    c.vault.setNoteSynced('n', true)
    await c.manager.start()
    await settled(c)
    a.sync.deaf = false
    document.dispatchEvent(new Event('visibilitychange')) // woke up, the app is shown again
    await until(async () => (await lines(a, 'n')).includes('C replaced'))
    expect(await lines(a, 'n')).toEqual(['C replaced'])
  })
})
