import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { memoryDir } from '@/adapters/fs/memory-dir'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { parseMarkdown } from '@/core/markdown/parse'
import { doc, p } from '@/core/markdown/pm-build'
import type { FileEntry } from '@/core/markdown/types'
import { Vault } from '@/core/vault/vault'
import { memoryDocIO } from './__fixtures__/memory-doc-io'
import { exportEntries } from './export'
import { restoreBackup, sourceFromDir } from './restore'
import { sourceFromEntries } from './source'
import { inlineTransferClient } from './transfer-client'
import type { ImportDeps } from './types'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let deps: ImportDeps & { docs: ReturnType<typeof memoryDocIO> }
let db: NotesDb
beforeEach(async () => {
  db = createDb('rs-' + Math.random().toString(36).slice(2))
  deps = {
    vault: await Vault.open(new MemoryStorage(), 'v', { channelFactory }),
    storage: new MemoryStorage(),
    db,
    docs: memoryDocIO(),
    parse: async (fs) => fs.map((f) => parseMarkdown(f.text)),
  }
})
afterEach(() => db.close())

const backup = async (): Promise<FileEntry[]> => {
  const out: FileEntry[] = []
  for await (const e of exportEntries({ kind: 'vault' }, { includeUnusedAttachments: false, includeDocs: true }, { ...deps, client: inlineTransferClient() })) out.push(e)
  return out
}
const text = (id: string) => deps.docs.docs.get(id)!.content![0].content![0].text
const live = () => deps.vault.listNotes().map((n) => n.title).sort()

describe('restore from backup', () => {
  it('replace: the vault equals the backup; ids kept; extras go to the trash', async () => {
    const { vault } = deps
    const f = vault.createFolder({ name: '專案', parentId: null })
    const a = vault.createNote({ title: 'A', folderId: f.id })
    await deps.docs.write(a.id, doc(p('備份時的內容')))
    const b = vault.createNote({ title: 'B' })
    await deps.docs.write(b.id, doc(p('b')))
    const zip = await backup()

    // After the backup: A edited and moved out, B trashed, C added.
    await deps.docs.replace(a.id, doc(p('後來改的')))
    vault.moveNote(a.id, { folderId: null, index: 0 })
    vault.trashNote(b.id)
    const c = vault.createNote({ title: 'C' })
    await deps.docs.write(c.id, doc(p('c')))

    await restoreBackup(sourceFromEntries(zip), 'replace', null, deps)
    expect(live()).toEqual(['A', 'B'])
    expect(text(a.id)).toBe('備份時的內容')
    expect(vault.listFolders().find((x) => x.id === vault.getNote(a.id)!.folderId)!.name).toBe('專案')
    expect(vault.getNote(b.id)!.deletedAt).toBeNull()
    expect(vault.getNote(c.id)!.deletedAt).not.toBeNull()
    expect(vault.listNotes({ includeTrashed: true }).some((n) => n.title.includes('覆蓋前'))).toBe(false)
  })

  it('merge: keeps both sides; existing notes follow the choice', async () => {
    const a = deps.vault.createNote({ title: 'A' })
    await deps.docs.write(a.id, doc(p('一')))
    const zip = await backup()
    deps.vault.createNote({ title: '新的' })
    await restoreBackup(sourceFromEntries(zip), 'merge', 'copy', deps)
    expect(live()).toEqual(['A', 'A (2)', '新的'])
  })

  it('a mirror folder restores too; its trash and kept copies are left out', async () => {
    const dir = memoryDir()
    await dir.write('筆記.md', '內容\n')
    await dir.write('.垃圾桶/丟掉的.md', 'x\n')
    await dir.write('筆記 (外部修改 2026-10-28 1432).md', '外面改的\n')
    const src = await sourceFromDir(dir)
    expect(src.entries.map((e) => e.path)).toEqual(['筆記.md'])
    await restoreBackup(src, 'replace', null, deps)
    expect(live()).toEqual(['筆記'])
  })
})
