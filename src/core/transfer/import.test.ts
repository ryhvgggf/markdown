import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { hashText } from '@/core/markdown/paths'
import { parseMarkdown } from '@/core/markdown/parse'
import { doc, p, noteLink } from '@/core/markdown/pm-build'
import type { PMNode } from '@/core/markdown/types'
import { Vault } from '@/core/vault/vault'
import { memoryDocIO } from './__fixtures__/memory-doc-io'
import { applyImport } from './import-apply'
import { planImport } from './import-plan'
import { IMPORT_JOB_KEY, type ImportDeps, type ImportSource, type V2Manifest } from './types'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let storage: MemoryStorage
let io: ReturnType<typeof memoryDocIO>
let deps: ImportDeps

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  storage = new MemoryStorage()
  db = createDb('imp-' + Math.random().toString(36).slice(2))
  io = memoryDocIO()
  deps = { vault, storage, db, docs: io, parse: async (fs) => fs.map((f) => parseMarkdown(f.text, { dialect: f.dialect })) }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 14, 30))
})
afterEach(() => {
  vi.useRealTimers()
  db.close()
})

const md = (path: string, text: string) => ({ path, text })
const png = (path: string, size = 10) => ({ path, blob: new Blob([new Uint8Array(size)], { type: 'image/png' }) })
const run = async (src: ImportSource, choices: Parameters<typeof applyImport>[2] = { destination: { kind: 'new-dated' }, onExisting: null }) =>
  applyImport(await planImport(src, deps), src, choices, deps)
const noteBy = (title: string) => vault.listNotes().find((n) => n.title === title)!
const types = (d: PMNode): string[] => [d.type, ...(d.content ?? []).flatMap(types)]

describe('import', () => {
  it('creates notes, folders, links and media under 「匯入 日期」', async () => {
    const report = await run({
      kind: 'markdown',
      entries: [
        md('A.md', '連到 [[B]] 與 [[C#小節]]\n\n![](附件/x.png)\n'),
        md('子/B.md', '# B\n'),
        md('子/C.md', '## 小節\n\n內容\n'),
        png('附件/x.png'),
      ],
    })
    const root = vault.listFolders().find((f) => f.name === '匯入 2026-10-28')!
    expect(root).toBeDefined()
    const sub = vault.listFolders().find((f) => f.name === '子')!
    expect(sub.parentId).toBe(root.id)
    expect(noteBy('A').folderId).toBe(root.id)
    expect(noteBy('B').folderId).toBe(sub.id)
    const a = io.docs.get(noteBy('A').id)!
    const links = a.content![0].content!.filter((n) => n.type === 'noteLink')
    expect(links.map((l) => l.attrs!.noteId)).toEqual([noteBy('B').id, noteBy('C').id])
    expect(links[1].attrs!.blockId).toBe(io.docs.get(noteBy('C').id)!.content![0].attrs!.id)
    expect(types(a)).toContain('media')
    expect(report).toMatchObject({ notes: 3, folders: 1, attachments: 1, unresolved: [] })
    expect(await db.meta.get(IMPORT_JOB_KEY)).toBeUndefined()
  })

  it('a title already in the vault gets (2) and is reported', async () => {
    vault.createNote({ title: 'A' })
    const report = await run({ kind: 'markdown', entries: [md('A.md', 'x')] })
    expect(noteBy('A (2)')).toBeDefined()
    expect(report.renamed).toEqual([{ from: 'A', to: 'A (2)', noteId: noteBy('A (2)').id }])
  })

  it('CRLF and BOM files import like plain ones', async () => {
    await run({ kind: 'markdown', entries: [md('W.md', '﻿# 標題\r\n\r\n內容\r\n')] }, { destination: { kind: 'folder', folderId: null }, onExisting: null })
    expect(noteBy('W').folderId).toBeNull()
    expect(io.docs.get(noteBy('W').id)!.content!.map((n) => n.type)).toEqual(['heading', 'paragraph'])
  })

  it('frontmatter tags and dates are used', async () => {
    await run({ kind: 'markdown', entries: [md('F.md', '---\ntags: [SAP, 採購]\ncreated: 2024-01-02\n---\n文字\n')] })
    const d = io.docs.get(noteBy('F').id)!
    expect(d.content!.at(-1)!.content!.filter((n) => n.type === 'tag').map((n) => n.attrs!.name)).toEqual(['SAP', '採購'])
    expect(noteBy('F').createdAt).toBe(new Date('2024-01-02').getTime())
  })

  it('a re-run with other choices starts over instead of resuming the old run', async () => {
    const src: ImportSource = { kind: 'markdown', entries: [md('1.md', 'a'), md('2.md', 'b')] }
    deps.docs = memoryDocIO({ failOn: 1 })
    await expect(applyImport(await planImport(src, deps), src, { destination: { kind: 'new-dated' }, onExisting: null }, deps)).rejects.toThrow()
    deps.docs = io
    const report = await applyImport(await planImport(src, deps), src, { destination: { kind: 'folder', folderId: null }, onExisting: null }, deps)
    expect(report.folderId).toBeNull()
    expect(vault.listNotes().every((n) => n.folderId === null)).toBe(true)
  })

  it('a file over 100 MB is skipped and the note still imports', async () => {
    const big = { path: 'big.mp4', blob: { size: 104_857_601, type: 'video/mp4' } as unknown as Blob }
    const report = await run({ kind: 'markdown', entries: [md('N.md', '![[big.mp4]]'), big] })
    expect(report.skipped).toEqual([{ path: 'big.mp4', reason: '檔案超過 100 MB' }])
    expect(io.docs.get(noteBy('N').id)!.content![0].content![0].text).toBe('（找不到附件：big.mp4）')
  })

  it('resumes after a failure without duplicating anything', async () => {
    const src: ImportSource = { kind: 'markdown', entries: [md('1.md', 'a'), md('2.md', 'b [[1]]'), md('3.md', 'c')] }
    io = memoryDocIO({ failOn: 2 })
    deps.docs = io
    const plan = await planImport(src, deps)
    await expect(applyImport(plan, src, { destination: { kind: 'new-dated' }, onExisting: null }, deps)).rejects.toThrow('write failed')
    expect(vault.listNotes().length).toBeLessThanOrEqual(1) // notes appear per chunk
    const report = await applyImport(await planImport(src, deps), src, { destination: { kind: 'new-dated' }, onExisting: null }, deps)
    expect(vault.listNotes().map((n) => n.title).sort()).toEqual(['1', '2', '3'])
    expect(vault.listFolders()).toHaveLength(1)
    expect(report.notes).toBe(3)
    expect(io.docs.get(noteBy('2').id)!.content![0].content!.find((n) => n.type === 'noteLink')!.attrs!.noteId).toBe(noteBy('1').id)
  })
})

describe('import with a v2 manifest', () => {
  const backup = (text = '內容\n'): ImportSource => {
    const d = doc({ ...p('內容'), attrs: { id: 'b1' } }, p(noteLink('n2')))
    const manifest: V2Manifest = {
      format: 'notes-v2', version: 1, exportedAt: 0, folders: [{ id: 'f1', path: '資料夾', order: 0 }], attachments: [],
      notes: [
        { id: 'n1', path: '資料夾/一.md', title: '一', createdAt: 5, updatedAt: 6, mdHash: hashText('內容\n'), blockIds: ['b1'], doc: d as PMNode },
        { id: 'n2', path: '二.md', title: '二', createdAt: 7, updatedAt: 8, mdHash: hashText('x\n'), blockIds: [] },
      ],
    }
    return { kind: 'v2', manifest, entries: [md('資料夾/一.md', text), md('二.md', 'x\n')] }
  }
  const root = { destination: { kind: 'folder' as const, folderId: null } }

  it('keeps ids, times and the exact document in an empty vault', async () => {
    await run(backup(), { ...root, onExisting: null })
    expect(vault.getNote('n1')).toMatchObject({ title: '一', createdAt: 5, updatedAt: 6 })
    expect(vault.listFolders().map((f) => f.id)).toEqual(['f1'])
    expect(io.docs.get('n1')!.content![0].attrs!.id).toBe('b1')
    expect(io.docs.get('n1')!.content![1].content![0].attrs!.noteId).toBe('n2')
  })

  it('an edited file is parsed instead of taken from the manifest', async () => {
    await run(backup('改過了\n'), { ...root, onExisting: null })
    expect(io.docs.get('n1')!.content![0].content![0].text).toBe('改過了')
  })

  it('requires a choice when notes already exist', async () => {
    await run(backup(), { ...root, onExisting: null })
    const src = backup()
    const plan = await planImport(src, deps)
    expect(plan.existingCount).toBe(2)
    await expect(applyImport(plan, src, { ...root, onExisting: null }, deps)).rejects.toThrow('請選擇')
  })

  it('copy: new ids, (2) titles, links follow the copies', async () => {
    await run(backup(), { ...root, onExisting: null })
    await run(backup(), { ...root, onExisting: 'copy' })
    const copy = noteBy('一 (2)')
    expect(copy.id).not.toBe('n1')
    expect(io.docs.get(copy.id)!.content![1].content![0].attrs!.noteId).toBe(noteBy('二 (2)').id)
  })

  it('a crash while overwriting does not lose a new note of the same chunk', async () => {
    await run(backup(), { ...root, onExisting: null })
    const src = backup()
    src.entries.unshift(md('新的.md', '新'))
    const io0 = io
    deps.docs = { ...io0, replace: async () => { throw new Error('crash') } }
    await expect(applyImport(await planImport(src, deps), src, { ...root, onExisting: 'overwrite' }, deps)).rejects.toThrow('crash')
    deps.docs = io0
    await applyImport(await planImport(src, deps), src, { ...root, onExisting: 'overwrite' }, deps)
    expect(vault.listNotes().map((n) => n.title).sort()).toEqual(['一', '二', '新的'])
  })

  it('overwrite: same id with the backup content; the old version is in the trash', async () => {
    await run(backup(), { ...root, onExisting: null })
    await io.replace('n1', doc(p('使用者後來改的')) as PMNode)
    vault.trashNote('n2')
    await run(backup(), { ...root, onExisting: 'overwrite' })
    expect(io.docs.get('n1')!.content![0].content![0].text).toBe('內容')
    expect(vault.getNote('n2')!.deletedAt).toBeNull()
    const old = vault.listNotes({ includeTrashed: true }).find((n) => n.title === '一（覆蓋前）')!
    expect(old.deletedAt).not.toBeNull()
    expect(io.docs.get(old.id)!.content![0].content![0].text).toBe('使用者後來改的')
    expect(vault.listNotes().filter((n) => n.title.startsWith('一'))).toHaveLength(1)
  })
})
