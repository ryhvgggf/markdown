import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { memoryDir } from '@/adapters/fs/memory-dir'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { doc, media, p } from '@/core/markdown/pm-build'
import type { PMNode } from '@/core/markdown/types'
import { memoryDocIO } from '@/core/transfer/__fixtures__/memory-doc-io'
import { inlineTransferClient } from '@/core/transfer/transfer-client'
import { Vault } from '@/core/vault/vault'
import { Mirror, type LockLike, type MirrorDeps } from './mirror'
import { loadState } from './mirror-state'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let storage: MemoryStorage
let io: ReturnType<typeof memoryDocIO>
let clock: number
let typing: boolean
let indexed: ((id: string) => void)[]
const mirrors: Mirror[] = []

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  db = createDb('mir-' + Math.random().toString(36).slice(2))
  storage = new MemoryStorage()
  io = memoryDocIO()
  clock = Date.UTC(2026, 9, 28, 6, 32)
  typing = false
  indexed = []
})
afterEach(() => {
  mirrors.splice(0).forEach((m) => m.stop())
  db.close()
})

const deps = (extra: Partial<MirrorDeps> = {}): MirrorDeps => ({
  vault, db, storage, docs: io, client: inlineTransferClient(),
  onIndexed: (cb) => (indexed.push(cb), () => (indexed = indexed.filter((x) => x !== cb))),
  isTyping: () => typing,
  idle: async () => {},
  sleep: async () => {},
  now: () => clock,
  ...extra,
})
async function started(extra: Partial<MirrorDeps> = {}) {
  const dir = memoryDir(() => ++clock)
  const m = new Mirror(deps(extra))
  mirrors.push(m)
  await m.start(dir)
  await m.whenIdle()
  return { m, dir }
}
const note = async (title: string, d: PMNode, folderId: string | null = null) => {
  const n = vault.createNote({ title, folderId })
  await io.write(n.id, d)
  return n
}
const edit = async (m: Mirror, id: string, d: PMNode) => {
  await io.replace(id, d)
  indexed.forEach((cb) => cb(id))
  await m.whenIdle()
}
const text = async (dir: ReturnType<typeof memoryDir>, path: string) => {
  const f = dir.files.get(path)
  return f === undefined ? undefined : typeof f.data === 'string' ? f.data : await f.data.text()
}

describe('mirror', () => {
  it('writes every note on start, then each edit after indexing', async () => {
    const f = vault.createFolder({ name: '專案', parentId: null })
    const n = await note('計畫', doc(p('一')), f.id)
    const { m, dir } = await started()
    expect(await text(dir, '專案/計畫.md')).toBe('一\n')
    await edit(m, n.id, doc(p('二')))
    expect(await text(dir, '專案/計畫.md')).toBe('二\n')
    expect((await loadState(db)).files[n.id].path).toBe('專案/計畫.md')
  })

  it('never writes while typing; writes once typing stops', async () => {
    const n = await note('A', doc(p('一')))
    const { m, dir } = await started()
    let polls = 0
    const mm = m as unknown as { sleep: (ms: number) => Promise<void> }
    mm.sleep = async () => {
      if (++polls === 3) typing = false
    }
    typing = true
    await edit(m, n.id, doc(p('二')))
    expect(polls).toBeGreaterThanOrEqual(3)
    expect(await text(dir, 'A.md')).toBe('二\n')
  })

  it('rename and move: the new file appears, the old one goes', async () => {
    const n = await note('A', doc(p('x')))
    const { m, dir } = await started()
    vault.renameNote(n.id, 'B')
    await m.whenIdle()
    expect([...dir.files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['B.md'])
    const f = vault.createFolder({ name: 'F', parentId: null })
    vault.moveNote(n.id, { folderId: f.id, index: 0 })
    await m.whenIdle()
    expect([...dir.files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['F/B.md'])
  })

  it('a file edited outside the app is kept under another name before the app writes', async () => {
    const n = await note('A', doc(p('一')))
    const { m, dir } = await started()
    dir.files.set('A.md', { data: '我在外面改的\n', mtime: ++clock })
    await edit(m, n.id, doc(p('二')))
    expect(await text(dir, 'A.md')).toBe('二\n')
    const kept = [...dir.files.keys()].find((k) => k.includes('外部修改'))!
    expect(kept).toMatch(/^A \(外部修改 \d{4}-\d{2}-\d{2} \d{4}\)\.md$/)
    expect(await text(dir, kept)).toBe('我在外面改的\n')
    expect(m.snapshot.conflicts).toHaveLength(1)
  })

  it('trash → .垃圾桶/; restore → back; delete for good → gone', async () => {
    const n = await note('A', doc(p('x')))
    const { m, dir } = await started()
    vault.trashNote(n.id)
    await m.whenIdle()
    expect([...dir.files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['.垃圾桶/A.md'])
    vault.restoreNote(n.id)
    await m.whenIdle()
    expect([...dir.files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['A.md'])
    vault.trashNote(n.id)
    await m.whenIdle()
    vault.purgeNote(n.id)
    await m.whenIdle()
    expect([...dir.files.keys()].filter((k) => k.endsWith('.md'))).toEqual([])
  })

  it('a deleted note whose file was edited outside is not deleted', async () => {
    const n = await note('A', doc(p('x')))
    const { m, dir } = await started()
    vault.trashNote(n.id)
    await m.whenIdle()
    dir.files.set('.垃圾桶/A.md', { data: '外面改了', mtime: ++clock })
    vault.purgeNote(n.id)
    await m.whenIdle()
    expect(dir.files.has('.垃圾桶/A.md')).toBe(true)
  })

  it('attachments are written when a note uses them, under 附件/', async () => {
    const a = vault.addAttachment({ filename: '圖.png', mimeType: 'image/png', size: 3 })
    await storage.putBlob(a.id, new Blob(['png']))
    vault.addAttachment({ filename: '沒用.png', mimeType: 'image/png', size: 3 })
    await note('A', doc(media(a.id, 'image')))
    const { dir } = await started()
    expect(await text(dir, 'A.md')).toBe('![圖.png](附件/圖.png)\n')
    expect([...dir.files.keys()].filter((k) => k.startsWith('附件/'))).toEqual(['附件/圖.png'])
  })

  it('a write that keeps failing is retried three times, then listed', async () => {
    const n = await note('A', doc(p('x')))
    const { m, dir } = await started()
    let calls = 0
    dir.write = async (path) => {
      if (path === 'A.md') calls++
      throw new Error('磁碟已滿')
    }
    await edit(m, n.id, doc(p('y')))
    for (let i = 0; i < 5; i++) await m.whenIdle()
    expect(calls).toBe(4)
    expect(m.snapshot.failed[n.id]).toBe('磁碟已滿')
  })

  it('a second tab waits for the lock and writes nothing meanwhile', async () => {
    let held = false
    const waiting: (() => void)[] = []
    const locks: LockLike = {
      request: async (_name, cb) => {
        if (held) await new Promise<void>((r) => waiting.push(r))
        held = true
        await cb()
        held = false
        waiting.shift()?.()
      },
    }
    await note('A', doc(p('x')))
    const first = await started({ locks })
    const dir2 = memoryDir()
    const second = new Mirror(deps({ locks }))
    mirrors.push(second)
    await second.start(dir2)
    await vi.waitFor(() => expect(first.m.status).toBe('active'))
    expect(second.status).toBe('waiting')
    expect(dir2.files.size).toBe(0)
  })

  it('two outside edits in the same minute keep two copies', async () => {
    const n = await note('A', doc(p('一')))
    const { m, dir } = await started()
    const fixed = clock
    const mm = m as unknown as { now: () => number }
    mm.now = () => fixed
    dir.files.set('A.md', { data: '外面 1\n', mtime: ++clock })
    await edit(m, n.id, doc(p('二')))
    dir.files.set('A.md', { data: '外面 2\n', mtime: ++clock })
    await edit(m, n.id, doc(p('三')))
    const kept = [...dir.files.keys()].filter((k) => k.includes('外部修改')).sort()
    expect(kept).toHaveLength(2)
    expect(await Promise.all(kept.map((k) => text(dir, k)))).toEqual(expect.arrayContaining(['外面 1\n', '外面 2\n']))
  })

  it('never writes an attachment over a file the user already has in the folder', async () => {
    const a = vault.addAttachment({ filename: 'photo.png', mimeType: 'image/png', size: 3 })
    await storage.putBlob(a.id, new Blob(['app']))
    await note('A', doc(media(a.id, 'image')))
    const dir = memoryDir(() => ++clock)
    dir.files.set('附件/photo.png', { data: '使用者自己的', mtime: 1 })
    const m = new Mirror(deps())
    mirrors.push(m)
    await m.start(dir)
    await m.whenIdle()
    expect(await text(dir, '附件/photo.png')).toBe('使用者自己的')
    expect(await text(dir, 'A.md')).toBe('![photo (2).png](附件/photo%20%282%29.png)\n')
  })

  it('a file deleted in the folder is written again on the next check', async () => {
    await note('A', doc(p('x')))
    const { m, dir } = await started()
    dir.files.delete('A.md')
    await m.reconcile()
    expect(await text(dir, 'A.md')).toBe('x\n')
  })

  it('records are read when the lock is granted, not before', async () => {
    const n = await note('A', doc(p('x')))
    const first = await started()
    let grant!: () => void
    const locks: LockLike = { request: async (_n, cb) => (await new Promise<void>((r) => (grant = r)), cb()) }
    const second = new Mirror(deps({ locks }))
    mirrors.push(second)
    void second.start(first.dir)
    await edit(first.m, n.id, doc(p('y'))) // the first tab writes while the second waits
    await first.m.stop()
    grant()
    await new Promise((r) => setTimeout(r, 0))
    await second.whenIdle()
    expect([...first.dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
  })

  it('stopping while waiting for the lock does not keep the lock when it is granted', async () => {
    let holder: Promise<void> = Promise.resolve()
    const locks: LockLike = {
      request: (_n, cb) => {
        const run = holder.then(() => cb())
        holder = run.catch(() => {})
        return run
      },
    }
    let releaseOther!: () => void
    void locks.request('x', () => new Promise<void>((r) => (releaseOther = r))) // another tab holds it
    await note('A', doc(p('x')))
    const m = new Mirror(deps({ locks }))
    mirrors.push(m)
    const dir = memoryDir()
    void m.start(dir)
    await m.stop()
    releaseOther()
    void m.start(dir)
    await vi.waitFor(() => expect(m.status).toBe('active'))
  })

  it('the manifest lists live notes with their ids, without documents', async () => {
    const n = await note('A', doc(p('x')))
    const { m, dir } = await started()
    await m.writeManifest()
    const man = JSON.parse((await text(dir, '.notes-v2.json'))!)
    expect(man.notes).toEqual([expect.objectContaining({ id: n.id, path: 'A.md', title: 'A' })])
    expect(man.notes[0].doc).toBeUndefined()
  })

  describe('records lost (site data cleared, restored backup)', () => {
    const restart = async (dir: ReturnType<typeof memoryDir>) => {
      await db.meta.clear()
      const m = new Mirror(deps())
      mirrors.push(m)
      await m.start(dir)
      await m.whenIdle()
      return m
    }

    it('a folder file identical to what would be written is adopted, not kept as an outside edit', async () => {
      const n = await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.stop()
      const m2 = await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
      expect(m2.snapshot.conflicts).toEqual([])
      expect(m2.snapshot.files[n.id].path).toBe('A.md')
    })

    it('a differing folder file without a record is still kept', async () => {
      await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.stop()
      dir.files.set('A.md', { data: '外面改了', mtime: ++clock })
      const m2 = await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toHaveLength(1)
      expect(m2.snapshot.conflicts).toHaveLength(1)
    })

    it('the folder manifest restores the records: a note edited since is overwritten without a kept copy', async () => {
      const n = await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      await io.replace(n.id, doc(p('二')))
      await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
      expect(await text(dir, 'A.md')).toBe('二\n')
    })

    it('adopting leaves the file untouched (same mtime)', async () => {
      await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.stop()
      const before = dir.files.get('A.md')!.mtime
      await restart(dir)
      expect(dir.files.get('A.md')!.mtime).toBe(before)
    })

    it('a manifest newer than the restored vault is not trusted: the folder text is kept', async () => {
      const n = await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      const raw = JSON.parse(await text(dir, '.notes-v2.json') as string)
      raw.notes[0].updatedAt = vault.getNote(n.id)!.updatedAt + 1000
      dir.files.set('.notes-v2.json', { data: JSON.stringify(raw), mtime: ++clock })
      await io.replace(n.id, doc(p('舊備份')))
      await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toHaveLength(1)
    })

    it('a broken manifest is ignored', async () => {
      await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.stop()
      for (const bad of ['{不是 json', '{"format":"notes-v2","notes":[null,{"id":1}]}']) {
        dir.files.set('.notes-v2.json', { data: bad, mtime: ++clock })
        await restart(dir)
        expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
      }
    })

    it('resume() seeds from the manifest too', async () => {
      const n = await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      await db.meta.clear()
      await io.replace(n.id, doc(p('二')))
      const m2 = new Mirror(deps())
      mirrors.push(m2)
      await m2.resume(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
      expect(await text(dir, 'A.md')).toBe('二\n')
    })

    it('attachments already in the folder are recognised from the manifest: no second copy, no kept note copy', async () => {
      const a = vault.addAttachment({ filename: '圖.png', mimeType: 'image/png', size: 3 })
      await storage.putBlob(a.id, new Blob(['png']))
      await note('A', doc(media(a.id, 'image')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toEqual([])
      expect([...dir.files.keys()].filter((k) => k.startsWith('附件/'))).toEqual(['附件/圖.png'])
      expect(await text(dir, 'A.md')).toBe('![圖.png](附件/圖.png)\n')
    })

    it('resume() after a stop during the manifest read does not reactivate', async () => {
      await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      await db.meta.clear()
      const slow = { ...dir, read: async (path: string) => (await Promise.resolve(), dir.read(path)) }
      const m2 = new Mirror(deps())
      mirrors.push(m2)
      await m2.start(dir)
      await m2.whenIdle()
      const pending = m2.resume(slow)
      await m2.stop()
      await pending
      expect(m2.status).toBe('off')
    })

    it('a stop during start does not throw', async () => {
      await note('A', doc(p('一')))
      const m = new Mirror(deps())
      mirrors.push(m)
      const dir = memoryDir(() => ++clock)
      const started = m.start(dir)
      await m.stop()
      await expect(started).resolves.toBeUndefined()
    })

    it('the manifest is not trusted for a file that no longer matches its hash', async () => {
      const n = await note('A', doc(p('一')))
      const { m, dir } = await started()
      await m.writeManifest()
      await m.stop()
      dir.files.set('A.md', { data: '外面改了', mtime: ++clock })
      await io.replace(n.id, doc(p('二')))
      await restart(dir)
      expect([...dir.files.keys()].filter((k) => k.includes('外部修改'))).toHaveLength(1)
    })
  })
})
