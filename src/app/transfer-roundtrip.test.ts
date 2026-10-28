import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { readZip, writeZip } from '@/adapters/zip/zip'
import { NoteDocCache } from '@/core/note-doc/cache'
import { assignBlockIds } from '@/core/blocks'
import { a, b, callout, code, codeBlock, doc, h, hl, hr, i, li, media, noteLink, ol, p, quote, s, table, tag, task, tasks, u, ul } from '@/core/markdown/pm-build'
import type { FileEntry, PMNode } from '@/core/markdown/types'
import { exportEntries } from '@/core/transfer/export'
import { applyImport } from '@/core/transfer/import-apply'
import { planImport } from '@/core/transfer/import-plan'
import { sourceFromEntries } from '@/core/transfer/source'
import { inlineTransferClient } from '@/core/transfer/transfer-client'
import { MANIFEST_PATH, type ImportDeps } from '@/core/transfer/types'
import { Vault } from '@/core/vault/vault'
import { createDocIO, normalizeDoc } from './doc-io'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

type Side = ImportDeps & { notes: NoteDocCache }
const opened: Side[] = []
async function side(): Promise<Side> {
  const storage = new MemoryStorage()
  const db: NotesDb = createDb('rt-' + Math.random().toString(36).slice(2))
  const vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  const notes = new NoteDocCache(storage)
  const client = inlineTransferClient()
  const s = { vault, storage, db, notes, docs: createDocIO({ storage, db, notes }), parse: client.parse }
  opened.push(s)
  return s
}
afterEach(() => opened.splice(0).forEach((s) => (s.db.close(), s.vault.close())))

async function exportAll(s: Side): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const deps = { vault: s.vault, storage: s.storage, docs: s.docs, client: inlineTransferClient() }
  for await (const e of exportEntries({ kind: 'vault' }, { includeUnusedAttachments: false, includeDocs: true }, deps)) out.push(e)
  return out
}
async function importInto(s: Side, entries: FileEntry[]) {
  const src = sourceFromEntries(entries)
  await applyImport(await planImport(src, s), src, { destination: { kind: 'folder', folderId: null }, onExisting: null }, s)
}
const texts = (es: FileEntry[]) => Object.fromEntries(es.filter((e) => e.text !== undefined && e.path !== MANIFEST_PATH).map((e) => [e.path, e.text]))

async function fixtureVault(): Promise<Side> {
  const v = await side()
  const folder = v.vault.createFolder({ name: '專案', parentId: null })
  const img = v.vault.addAttachment({ filename: '圖 1.png', mimeType: 'image/png', size: 3 })
  await v.storage.putBlob(img.id, new Blob(['png'], { type: 'image/png' }))
  const pdf = v.vault.addAttachment({ filename: '報告.pdf', mimeType: 'application/pdf', size: 3 })
  await v.storage.putBlob(pdf.id, new Blob(['pdf'], { type: 'application/pdf' }))
  const two = v.vault.createNote({ title: '第二篇', folderId: folder.id })
  await v.docs.write(two.id, doc({ ...h(2, '小節'), attrs: { level: 2, id: 'hd' } }, { ...p('被連結'), attrs: { id: 'blk' } }))
  const one = v.vault.createNote({ title: '第一篇' })
  await v.docs.write(
    one.id,
    assignBlockIds(doc(
      h(1, '大標題'),
      p('一般', b('粗'), i('斜'), s('刪'), u('底'), hl('螢光', '#FFF1A8'), code('c'), a('連結', 'https://e.com')),
      p('需要跳脫：1. # - > * _ ` [ ] < ~ ==x== #非標籤'),
      p(noteLink(two.id), ' ', noteLink(two.id, 'hd'), ' ', noteLink(two.id, 'blk'), ' ', tag('SAP')),
      p({ type: 'noteLink', attrs: { noteId: two.id, blockId: null, label: '別名 A' } }, ' ', { type: 'noteLink', attrs: { noteId: two.id, blockId: 'hd', label: '小節別名' } }),
      ul(li('項目', ul('子項目')), '第二項'),
      ol('一', '二'),
      tasks(task(false, '待辦'), task(true, '完成')),
      quote(p('引用')),
      callout('tip', p('提示')),
      codeBlock('ts', 'const a = 1'),
      table(['名稱', '說明'], [['a', 'x|y']]),
      media(img.id, 'image'),
      media(pdf.id, 'file'),
      hr(),
      p('結尾'),
    )),
  )
  return v
}

describe('export → import → export', () => {
  it('with the manifest: identical files, ids and documents', async () => {
    const src = await fixtureVault()
    const first = await exportAll(src)
    const dst = await side()
    await importInto(dst, first)
    const second = await exportAll(dst)
    expect(texts(second)).toEqual(texts(first))
    for (const n of src.vault.listNotes()) {
      expect(dst.vault.getNote(n.id)?.title).toBe(n.title)
      expect(await dst.docs.read(n.id)).toEqual(normalizeDoc(await src.docs.read(n.id)))
    }
    expect(second.filter((e) => e.blob).map((e) => e.path)).toEqual(first.filter((e) => e.blob).map((e) => e.path))
  })

  it('a note with colours (not in Markdown) comes back exactly through the manifest', async () => {
    const src = await side()
    const n = src.vault.createNote({ title: '彩色' })
    await src.docs.write(n.id, assignBlockIds(doc(p({ type: 'text', text: '紅字', marks: [{ type: 'textStyle', attrs: { color: '#C62828' } }] }))))
    const dst = await side()
    await importInto(dst, await exportAll(src))
    expect(await dst.docs.read(n.id)).toEqual(normalizeDoc(await src.docs.read(n.id)))
  })

  it('without the manifest (any Markdown editor): identical files', async () => {
    const first = (await exportAll(await fixtureVault())).filter((e) => e.path !== MANIFEST_PATH)
    const dst = await side()
    await importInto(dst, first)
    expect(texts(await exportAll(dst))).toEqual(texts(first))
  })

  it('survives a real ZIP', async () => {
    const src = await fixtureVault()
    const zip = await writeZip((async function* () { yield* await exportAll(src) })())
    const dst = await side()
    await importInto(dst, await readZip(zip))
    expect(texts(await exportAll(dst))).toEqual(texts(await exportAll(src)))
  })

  it('titles that clean up to the same file name still link to the right notes', async () => {
    const src = await side()
    const x = src.vault.createNote({ title: 'a/b' })
    const y = src.vault.createNote({ title: 'ab' })
    await src.docs.write(x.id, doc(p('到 ', noteLink(y.id))))
    await src.docs.write(y.id, doc(p('到 ', noteLink(x.id))))
    const dst = await side()
    await importInto(dst, await exportAll(src))
    const link = async (id: string) => ((await dst.docs.read(id)).content![0].content as PMNode[]).find((n) => n.type === 'noteLink')!.attrs!.noteId
    expect(await link(x.id)).toBe(y.id)
    expect(await link(y.id)).toBe(x.id)
  })
})
