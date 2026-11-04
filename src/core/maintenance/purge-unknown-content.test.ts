// @vitest-environment node
// "Delete forever" of a note judges "unused" from what is stored on this device. A synced note whose content has
// not been downloaded here yet reads as an empty doc but may use any attachment: nothing is purged then (4b review,
// finding 1). A synced note that was never edited is genuinely empty and must not block anything.
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

let db: NotesDb
let storage: MemoryStorage
let vault: Vault
let m: Maintenance

beforeEach(async () => {
  db = createDb('rv2-' + Math.random().toString(36).slice(2))
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

it('delete forever of one note does not purge an attachment a not-yet-downloaded synced note may use', async () => {
  const a = vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 3 })
  await storage.putBlob(a.id, new Blob(['abc']))
  // N1: content here, uses the attachment
  const n1 = vault.createNote({ title: 'One' })
  const d = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  const e = new Y.XmlElement('media')
  e.setAttribute('attachmentId', a.id)
  p.insert(0, [e])
  d.getXmlFragment('content').insert(0, [p])
  await storage.appendUpdate(n1.id, Y.encodeStateAsUpdate(d))
  // N2: synced, metadata from the manifest only (its content, which pasted the same image, is still downloading)
  const n2 = vault.createNote({ title: 'Two (content not pulled yet)', createdAt: Date.now() - 5000, updatedAt: Date.now() }) // edited on the other device
  vault.setNoteSynced(n2.id, true)
  const purged: string[] = []
  vault.onAttachmentPurged((id) => purged.push(id))
  vault.trashNote(n1.id)
  await m.purge({ kind: 'note', id: n1.id })
  expect(purged).toEqual([])
})

it('a synced note that was never edited is empty, not unknown: the purge goes ahead', async () => {
  const a = vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 3 })
  await storage.putBlob(a.id, new Blob(['abc']))
  const n1 = vault.createNote({ title: 'One' })
  const d = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  const e = new Y.XmlElement('media')
  e.setAttribute('attachmentId', a.id)
  p.insert(0, [e])
  d.getXmlFragment('content').insert(0, [p])
  await storage.appendUpdate(n1.id, Y.encodeStateAsUpdate(d))
  vault.setNoteSynced(vault.createNote({ title: 'Empty, synced, never edited' }).id, true)
  const purged: string[] = []
  vault.onAttachmentPurged((id) => purged.push(id))
  vault.trashNote(n1.id)
  await m.purge({ kind: 'note', id: n1.id })
  expect(purged).toEqual([a.id])
})
