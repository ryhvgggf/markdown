import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { readZip, writeZip } from '@/adapters/zip/zip'
import { parseMarkdown } from '@/core/markdown/parse'
import type { FileEntry, PMNode } from '@/core/markdown/types'
import { Vault } from '@/core/vault/vault'
import { memoryDocIO } from './__fixtures__/memory-doc-io'
import { applyImport } from './import-apply'
import { planImport } from './import-plan'
import type { ImportDeps } from './types'
import { isV1Zip, v1ZipToSource } from './v1-zip'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let deps: ImportDeps & { docs: ReturnType<typeof memoryDocIO> }
let db: NotesDb
beforeEach(async () => {
  db = createDb('v1-' + Math.random().toString(36).slice(2))
  deps = {
    vault: await Vault.open(new MemoryStorage(), 'v', { channelFactory }),
    storage: new MemoryStorage(),
    db,
    docs: memoryDocIO(),
    parse: async (fs) => fs.map((f) => parseMarkdown(f.text, { dialect: f.dialect })),
  }
})
afterEach(() => db.close())

function v1Zip(version = 3): Promise<Blob> {
  const manifest = {
    format: 'markdown-vault-zip', version, kind: 'vault', exportedAt: '2024-05-01T00:00:00Z', vaultName: 'v1', customFolders: ['工作/空的'],
    notes: [
      { id: 'a', title: '採購流程', folder: '工作', tags: [], outlinks: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z', path: 'notes/a.md' },
      { id: 'b', title: '首頁', tags: [], outlinks: [], createdAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-03T00:00:00Z', path: 'notes/b.md' },
      { id: 'c', title: '首頁', tags: [], outlinks: [], createdAt: '2024-01-05T00:00:00Z', updatedAt: '2024-01-05T00:00:00Z', path: 'notes/c.md' },
    ],
    media: [
      { id: 'm1', filename: '流程圖.png', mimeType: 'image/png', size: 3, createdAt: '2024-01-01T00:00:00Z', path: 'media/m1/流程圖.png' },
      { id: 'm2', filename: '報告.pdf', mimeType: 'application/pdf', size: 3, createdAt: '2024-01-01T00:00:00Z', path: 'media/m2/報告.pdf' },
    ],
  }
  const files: FileEntry[] = [
    { path: 'manifest.json', text: JSON.stringify(manifest) },
    { path: 'notes/a.md', text: '見 [[首頁]]\n\n![[m1|流程圖]]\n\n![[報告.pdf]]\n\n:::quote\n引用\n:::\n' },
    { path: 'notes/b.md', text: '舊的首頁' },
    { path: 'notes/c.md', text: '新的首頁' },
    { path: 'media/m1/流程圖.png', blob: new Blob(['png']) },
    { path: 'media/m2/報告.pdf', blob: new Blob(['pdf']) },
  ]
  return writeZip((async function* () { yield* files })())
}
const types = (d: PMNode): string[] => [d.type, ...(d.content ?? []).flatMap(types)]

describe('v1 backup ZIP', () => {
  it('imports notes, folders (empty ones too), times, media, files and links', async () => {
    const entries = await readZip(await v1Zip())
    expect(isV1Zip(entries)).toBe(true)
    const src = v1ZipToSource(entries)
    const report = await applyImport(await planImport(src, deps), src, { destination: { kind: 'folder', folderId: null }, onExisting: null }, deps)
    const { vault } = deps
    expect(vault.listFolders().map((f) => f.name).sort()).toEqual(['工作', '空的'])
    const note = vault.listNotes().find((n) => n.title === '採購流程')!
    expect(note.createdAt).toBe(Date.parse('2024-01-01T00:00:00Z'))
    expect(vault.listFolders().find((f) => f.id === note.folderId)!.name).toBe('工作')
    const d = deps.docs.docs.get(note.id)!
    expect(types(d)).toEqual(expect.arrayContaining(['noteLink', 'media', 'blockquote']))
    const media = JSON.stringify(d)
    expect(media).toContain('"kind":"image"')
    expect(media).toContain('"kind":"file"')
    // Same title: the earlier note keeps it.
    expect(deps.docs.docs.get(vault.listNotes().find((n) => n.title === '首頁')!.id)!.content![0].content![0].text).toBe('舊的首頁')
    expect(report.renamed.map((r) => r.to)).toEqual(['首頁 (2)'])
    expect(report.attachments).toBe(2)
  })

  it('other versions are refused', async () => {
    const entries = await readZip(await v1Zip(2))
    expect(() => v1ZipToSource(entries)).toThrow('不支援此 v1 備份版本')
  })
})
