import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { doc, media, noteLink, p } from '@/core/markdown/pm-build'
import type { FileEntry, PMNode } from '@/core/markdown/types'
import { Vault } from '@/core/vault/vault'
import { memoryDocIO } from './__fixtures__/memory-doc-io'
import { exportEntries, exportFile, type ExportScope } from './export'
import { inlineTransferClient } from './transfer-client'
import type { V2Manifest } from './types'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let storage: MemoryStorage
let io: ReturnType<typeof memoryDocIO>
beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  storage = new MemoryStorage()
  io = memoryDocIO()
})
afterEach(() => vault.close())

const deps = () => ({ vault, storage, docs: io, client: inlineTransferClient() })
const all = async (scope: ExportScope = { kind: 'vault' }, includeUnusedAttachments = false) => {
  const out: FileEntry[] = []
  for await (const e of exportEntries(scope, { includeUnusedAttachments, includeDocs: true }, deps())) out.push(e)
  return out
}
const note = async (title: string, d: PMNode, folderId: string | null = null) => {
  const n = vault.createNote({ title, folderId })
  await io.write(n.id, d)
  return n
}
const attach = async (filename: string) => {
  const a = vault.addAttachment({ filename, mimeType: 'image/png', size: 3 })
  await storage.putBlob(a.id, new Blob(['abc']))
  return a
}

describe('export', () => {
  it('writes folders, attachments and the manifest as in spec 6.3; trash is left out', async () => {
    const f = vault.createFolder({ name: '資料夾A', parentId: null })
    const sub = vault.createFolder({ name: '子資料夾', parentId: f.id })
    const img = await attach('範例圖片.png')
    const img2 = await attach('範例圖片.png')
    await attach('沒用到.png')
    await note('筆記', p('x'), sub.id)
    await note('另一篇', doc(media(img.id, 'image'), media(img2.id, 'image')), f.id)
    await note('根目錄的筆記', doc(p('y')))
    const gone = await note('丟掉', doc(p('z')))
    vault.trashNote(gone.id)
    const files = await all()
    expect(files.map((e) => e.path)).toEqual([
      '根目錄的筆記.md', '資料夾A/另一篇.md', '資料夾A/子資料夾/筆記.md', '附件/範例圖片.png', '附件/範例圖片 (2).png', '.notes-v2.json',
    ])
    const m = JSON.parse(files.at(-1)!.text!) as V2Manifest
    expect(m.notes.map((n) => n.title)).toEqual(['根目錄的筆記', '另一篇', '筆記'])
    expect(m.folders.map((x) => x.path)).toEqual(['資料夾A', '資料夾A/子資料夾'])
    expect(m.notes[1].doc).toBeUndefined() // nothing Markdown cannot hold: the .md and block ids are enough
    expect(files[1].text).toBe('![範例圖片.png](附件/範例圖片.png)\n\n![範例圖片 (2).png](附件/範例圖片%20%282%29.png)\n')
  })

  it('unused attachments only when asked', async () => {
    await attach('a.png')
    expect((await all({ kind: 'vault' }, true)).map((e) => e.path)).toContain('附件/a.png')
  })

  it('a link to a note in the trash keeps its title', async () => {
    const t = await note('已丟的', doc(p('x')))
    vault.trashNote(t.id)
    await note('A', doc(p('看 ', noteLink(t.id))))
    expect((await all())[0].text).toBe('看 [[已丟的]]\n')
  })

  it('titles that clean up to the same file name get (2)', async () => {
    await note('a/b', doc(p('1')))
    await note('ab', doc(p('2')))
    expect((await all()).map((e) => e.path).slice(0, 2)).toEqual(['ab.md', 'ab (2).md'])
  })

  it('block links get an anchor on the target; heading links use the heading text', async () => {
    const target = vault.createNote({ title: 'T' })
    await io.write(target.id, doc({ type: 'heading', attrs: { level: 2, id: 'h' }, content: [{ type: 'text', text: '小節' }] }, { ...p('段'), attrs: { id: 'b' } }))
    await note('S', doc(p(noteLink(target.id, 'h'), ' ', noteLink(target.id, 'b'))))
    const [t, s] = await all()
    expect(t.text).toBe('## 小節\n\n段 ^b\n')
    expect(s.text).toBe('[[T#小節]] [[T#^b]]\n')
  })

  it('a folder export holds that folder; a note export is one .md', async () => {
    const f = vault.createFolder({ name: '專案', parentId: null })
    const n = await note('計畫', doc(p('x')), f.id)
    await note('外面', doc(p('y')))
    expect((await all({ kind: 'folder', folderId: f.id })).map((e) => e.path)).toEqual(['專案/計畫.md', '.notes-v2.json'])
    const one = await exportFile({ kind: 'note', noteId: n.id }, { includeUnusedAttachments: false, includeDocs: false }, { ...deps(), writeZip: async () => new Blob() })
    expect(one.fileName).toBe('計畫.md')
    expect(await one.blob.text()).toBe('x\n')
  })
})
