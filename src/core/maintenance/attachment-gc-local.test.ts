// @vitest-environment node
// The daily unreferenced-attachment GC judges "unused" on this device only, so it must delete the local copy
// only: a device that has a synced note's metadata but not yet its content would otherwise turn that guess into a
// permanent cloud removal mark and delete the cloud copy for every device (4b review, finding 1).
import { afterEach, beforeEach, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Indexer } from '../indexer/indexer'
import { NoteDocCache } from '../note-doc/cache'
import { Vault } from '../vault/vault'
import { INDEX_VERSION, Maintenance } from './maintenance'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const DAY = 86_400_000

let db: NotesDb
let storage: MemoryStorage
let vault: Vault
let m: Maintenance

beforeEach(async () => {
  db = createDb('rv-' + Math.random().toString(36).slice(2))
  storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1', { channelFactory: fakeChannel })
  const notes = new NoteDocCache(storage, { channelFactory: fakeChannel })
  const indexer = new Indexer(db, vault, notes, storage)
  m = new Maintenance({ db, storage, vault, notes, indexer, onError: () => {} })
  await db.meta.put({ key: 'indexVersion', value: INDEX_VERSION })
})
afterEach(() => {
  vault.close()
  db.close()
})

it('GC on a device whose synced note content is not downloaded yet must not signal a deliberate purge', async () => {
  // As sync leaves a second device: note metadata from the manifest (no doc yet), attachment downloaded with
  // the original device's createdAt (60 days ago).
  vault.createNote({ title: 'Pics (content not pulled yet)' })
  vault.addAttachment({ id: 'att1', filename: 'a.png', mimeType: 'image/png', size: 3 })
  ;(vault.doc.getMap('attachments').get('att1') as Y.Map<unknown>).set('createdAt', Date.now() - 60 * DAY)
  await storage.putBlob('att1', new Blob(['abc']))
  const purged: string[] = []
  vault.onAttachmentPurged((id) => purged.push(id))
  await m.runStartup()
  expect(purged).toEqual([])
  expect(vault.getAttachment('att1')).toBeUndefined() // the local copy goes (sync brings it back if a note uses it)
})
