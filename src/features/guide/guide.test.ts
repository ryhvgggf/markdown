// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type { Node as PMNode } from '@tiptap/pm/model'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Vault } from '@/core/vault/vault'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Indexer } from '@/core/indexer/indexer'
import { addGuide, GUIDE_FOLDER, GUIDE_TITLES, guideSchema } from './guide'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let db: NotesDb
let storage: MemoryStorage
let vault: Vault

beforeEach(async () => {
  db = createDb('guide-' + Math.random().toString(36).slice(2))
  storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1', { channelFactory: fakeChannel })
})
afterEach(() => {
  vault.close()
  db.close()
})

async function loadNode(noteId: string): Promise<PMNode> {
  const doc = new Y.Doc()
  for (const u of await storage.loadDoc(noteId)) Y.applyUpdate(doc, u)
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('content'), guideSchema())
}

function collect(node: PMNode) {
  const types = new Set<string>()
  const links: Array<{ noteId: string; blockId: string | null }> = []
  const blockIds = new Set<string>()
  const langs = new Set<string>()
  const tags = new Set<string>()
  let maxOlDepth = 0
  node.descendants((n, pos) => {
    types.add(n.type.name)
    if (n.attrs.id) blockIds.add(n.attrs.id as string)
    if (n.type.name === 'noteLink') links.push({ noteId: n.attrs.noteId as string, blockId: (n.attrs.blockId as string | null) ?? null })
    if (n.type.name === 'codeBlock' && n.attrs.language) langs.add(n.attrs.language as string)
    if (n.type.name === 'tag') tags.add(n.attrs.name as string)
    if (n.type.name === 'orderedList') {
      const $p = node.resolve(pos)
      let d = 1
      for (let i = $p.depth; i >= 0; i--) if ($p.node(i).type.name === 'orderedList') d++
      maxOlDepth = Math.max(maxOlDepth, d)
    }
  })
  return { types, links, blockIds, langs, tags, maxOlDepth }
}

describe('addGuide', () => {
  it('creates the 功能導覽 folder with every guide note, in order, as valid documents', async () => {
    const { folderId, noteIds } = await addGuide({ vault, storage, db })
    const folder = vault.listFolders().find((f) => f.id === folderId)!
    expect(folder.name).toBe(GUIDE_FOLDER)
    expect(folder.parentId).toBeNull()
    const inFolder = vault
      .listNotes()
      .filter((n) => n.folderId === folderId)
      .sort((a, b) => (a.order < b.order ? -1 : 1))
    expect(inFolder.map((n) => n.title)).toEqual(GUIDE_TITLES)
    expect(inFolder.map((n) => n.id)).toEqual(noteIds)
    expect(GUIDE_TITLES[0]).toBe('歡迎使用')
    for (const id of noteIds) {
      const node = await loadNode(id)
      node.check() // throws when the content does not fit the editor schema
      expect(node.childCount).toBeGreaterThanOrEqual(3)
      node.descendants((n) => {
        if (['paragraph', 'heading', 'codeBlock', 'table', 'callout', 'listItem', 'taskItem', 'media'].includes(n.type.name)) {
          expect(n.attrs.id, `${n.type.name} has a block id`).toBeTruthy()
        }
      })
    }
  })

  it('links between guide notes resolve, block links point at real blocks, and real blocks exist', async () => {
    const { noteIds } = await addGuide({ vault, storage, db })
    const docs = new Map<string, ReturnType<typeof collect>>()
    for (const id of noteIds) docs.set(id, collect(await loadNode(id)))
    let blockLinks = 0
    for (const { links } of docs.values()) {
      for (const l of links) {
        expect(noteIds).toContain(l.noteId)
        if (l.blockId) {
          blockLinks++
          expect(docs.get(l.noteId)!.blockIds.has(l.blockId)).toBe(true)
        }
      }
    }
    const welcome = docs.get(noteIds[0])!
    // the welcome note indexes every other guide note
    expect(new Set(welcome.links.map((l) => l.noteId))).toEqual(new Set(noteIds.slice(1)))
    expect(blockLinks).toBeGreaterThan(0)
  })

  it('demonstrates the blocks it describes', async () => {
    const { noteIds } = await addGuide({ vault, storage, db })
    const all = { types: new Set<string>(), langs: new Set<string>(), tags: new Set<string>(), maxOlDepth: 0 }
    for (const id of noteIds) {
      const c = collect(await loadNode(id))
      c.types.forEach((t) => all.types.add(t))
      c.langs.forEach((t) => all.langs.add(t))
      c.tags.forEach((t) => all.tags.add(t))
      all.maxOlDepth = Math.max(all.maxOlDepth, c.maxOlDepth)
    }
    for (const t of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'callout', 'codeBlock', 'table', 'horizontalRule', 'media', 'noteLink', 'tag']) {
      expect(all.types, t).toContain(t)
    }
    expect(all.langs).toContain('abap')
    expect(all.tags).toContain('功能導覽')
    expect(all.maxOlDepth).toBeGreaterThanOrEqual(3) // 1. → a. → i.
  })

  it('stores the demo image as a real attachment', async () => {
    const { noteIds } = await addGuide({ vault, storage, db })
    const ids: string[] = []
    for (const id of noteIds) (await loadNode(id)).descendants((n) => void (n.type.name === 'media' && ids.push(n.attrs.attachmentId as string)))
    expect(ids).toHaveLength(1)
    expect(vault.getAttachment(ids[0])?.mimeType).toBe('image/png')
    const blob = await storage.getBlob(ids[0])
    expect(blob?.size).toBeGreaterThan(100)
  })

  it('is picked up by the indexer: links, tags and blocks', async () => {
    const { noteIds } = await addGuide({ vault, storage, db })
    const cache = new NoteDocCache(storage, { channelFactory: fakeChannel })
    const indexer = new Indexer(db, vault, cache, storage)
    expect(await db.meta.where('key').startsWith('dirty:').count()).toBe(noteIds.length) // indexed on the next catch-up
    await indexer.catchUp()
    const targets = (await db.links.where('sourceNoteId').equals(noteIds[0]).toArray()).map((l) => l.targetNoteId)
    expect(new Set(targets)).toEqual(new Set(noteIds.slice(1)))
    expect(await db.tags.where('tag').equals('功能導覽').count()).toBeGreaterThan(0)
    expect(await db.blocks.where('noteId').equals(noteIds[2]).count()).toBeGreaterThan(5)
    expect((await db.noteText.get(noteIds[0]))?.text).toContain('本機')
  })

  it('adds a second copy with suffixed titles that links to its own notes', async () => {
    const first = await addGuide({ vault, storage, db })
    const second = await addGuide({ vault, storage, db })
    expect(second.folderId).not.toBe(first.folderId)
    const titles = second.noteIds.map((id) => vault.getNote(id)!.title)
    expect(titles).toEqual(GUIDE_TITLES.map((t) => `${t} (2)`))
    for (const l of collect(await loadNode(second.noteIds[0])).links) expect(second.noteIds).toContain(l.noteId)
  })
})
