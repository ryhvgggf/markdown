import { beforeEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryShare } from '@/adapters/share/memory-share'
import { MAX_SHARE_FILE_BYTES, ORPHAN_FOLDER_GRACE_MS, ShareError } from '@/adapters/share/types'
import type { PMNode } from '@/core/markdown/types'
import { sanitizeShareFiles, shareFileCode, type PendingShareFile, type ShareFile } from './files'
import { createShareService, openShareFile, openSharedLink } from './share-service'
import { buildMultiShareSnapshot, buildShareSnapshot, sanitizeSnapshot, type AnyShareSnapshot } from './snapshot'

/** Phase 4d: attachments of share links. */

const ORIGIN = 'https://notes.example'
const te = new TextEncoder()
const td = new TextDecoder()
const media = (attachmentId: string, kind = 'image', width: number | null = 320): PMNode => ({ type: 'media', attrs: { attachmentId, kind, width } })
const docOf = (...blocks: PMNode[]): PMNode => ({ type: 'doc', content: blocks })
const para = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

type Att = { id: string; name: string; mime: string; body: string }
/** What the app passes (see `shareContentOfNote`): codes in order, the bytes read lazily. */
function pendingOf(atts: Att[], reads: string[] = []) {
  const pending: PendingShareFile[] = atts.map((a, i) => ({
    code: shareFileCode(i),
    attachmentId: a.id,
    name: a.name,
    mime: a.mime,
    size: te.encode(a.body).length,
    read: async () => {
      reads.push(a.id)
      return te.encode(a.body)
    },
  }))
  const map = new Map(atts.map((a, i) => [a.id, { code: shareFileCode(i), mime: a.mime }]))
  return { pending, map }
}
const snapWith = (atts: Att[], extra: PMNode[] = [], at = 1) => {
  const { map } = pendingOf(atts)
  return buildShareSnapshot({ title: 'T', doc: docOf(...atts.map((a) => media(a.id, a.mime.startsWith('video') ? 'video' : 'image')), ...extra), sharedAt: at, linkLabel: () => null, files: map })
}
const errOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ShareError)
    return e as ShareError
  }
  throw new Error('expected a ShareError')
}
const filesOf = (s: AnyShareSnapshot) => s.files ?? []

const A: Att = { id: 'att-a', name: 'a.png', mime: 'image/png', body: 'AAAA-secret-image' }
const B: Att = { id: 'att-b', name: 'b.mp4', mime: 'video/mp4', body: 'BBBB-secret-video' }
const C: Att = { id: 'att-c', name: 'c.pdf', mime: 'application/pdf', body: 'CCCC-secret-pdf' }

describe('share attachments (phase 4d)', () => {
  let now: number
  let store: MemoryShare
  let service: ReturnType<typeof createShareService>
  let account: { userId: string; vaultId: string; kek: CryptoKey }
  const open = (url: string, password?: string) => openSharedLink(store, new URL(url), undefined, password)
  const read = async (url: string, f: ShareFile) => td.decode(await openShareFile(store, new URL(url), f))
  const objectsOf = (shareId: string) => [...store.files.keys()].filter((k) => k.startsWith(`${shareId}/`))

  beforeEach(async () => {
    now = 1_000_000
    store = new MemoryShare(() => now++)
    account = { userId: 'u1', vaultId: 'v1', kek: await generateKek() }
    service = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
  })

  it('uploads each file encrypted; the viewer gets the media nodes, the list and the bytes', async () => {
    const { pending } = pendingOf([A, B])
    const { url, record } = await service.create('n1', snapWith([A, B]), pending)
    const opened = await open(url)
    expect(opened.v === 1 && opened.doc.content?.map((n) => n.attrs)).toEqual([
      { attachmentId: 'a0', kind: 'image', width: 320 },
      { attachmentId: 'a1', kind: 'video', width: 320 },
    ])
    const files = filesOf(opened)
    expect(files.map((f) => [f.code, f.name, f.mime, f.size])).toEqual([
      ['a0', 'a.png', 'image/png', A.body.length],
      ['a1', 'b.mp4', 'video/mp4', B.body.length],
    ])
    expect(await read(url, files[0])).toBe(A.body)
    expect(await read(url, files[1])).toBe(B.body)
    // The server has neither the bytes, nor the real attachment ids, nor the file keys.
    expect(objectsOf(record.id)).toHaveLength(2)
    const stored = [...store.files.values()].map((b) => new TextDecoder('latin1').decode(b)).join() + new TextDecoder('latin1').decode(store.rows.get(record.id)!.ciphertext)
    for (const s of [A.body, B.body, 'att-a', files[0].key]) expect(stored).not.toContain(s)
  })

  it('one attachment used twice is one file', async () => {
    const { pending, map } = pendingOf([A])
    const snap = buildShareSnapshot({ title: 'T', doc: docOf(media('att-a'), para('x'), media('att-a')), sharedAt: 1, linkLabel: () => null, files: map })
    const { url, record } = await service.create('n1', snap, pending)
    const opened = await open(url)
    expect(filesOf(opened)).toHaveLength(1)
    expect(objectsOf(record.id)).toHaveLength(1)
  })

  it('refuses a file over 20 MB (naming it) or more than 50 MB in all, before uploading anything', async () => {
    const big = { ...pendingOf([A]).pending[0], name: 'huge.mov', size: MAX_SHARE_FILE_BYTES + 1 }
    const e = await errOf(service.create('n1', snapWith([A]), [big]))
    expect([e.kind, e.detail]).toEqual(['file-too-large', 'huge.mov'])
    const many = [A, B, C].map((a, i) => ({ ...pendingOf([a]).pending[0], code: shareFileCode(i), size: 18 * 1024 * 1024 }))
    expect((await errOf(service.create('n1', snapWith([A, B, C]), many))).kind).toBe('files-too-large')
    expect(store.files.size).toBe(0)
    expect(store.rows.size).toBe(0)
  })

  it('a failed upload leaves nothing behind', async () => {
    const { pending } = pendingOf([A, B])
    const upload = store.uploadFile.bind(store)
    let n = 0
    store.uploadFile = async (...args) => {
      if (n++ === 1) throw new ShareError('unknown', 'network')
      return upload(...args)
    }
    expect((await errOf(service.create('n1', snapWith([A, B]), pending))).kind).toBe('unknown')
    expect(store.files.size).toBe(0)
    expect(store.rows.size).toBe(0)
  })

  it('updating the snapshot reuses unchanged files, uploads new ones and deletes the ones no longer used', async () => {
    const { url, record } = await service.create('n1', snapWith([A, B]), pendingOf([A, B]).pending)
    const before = filesOf(await open(url))
    const reads: string[] = []
    await service.update(record, snapWith([B, C], [], 2), pendingOf([B, C], reads).pending)
    expect(reads).toEqual(['att-c']) // B was not read again
    const after = filesOf(await open(url))
    expect(after.map((f) => [f.code, f.name])).toEqual([
      ['a0', 'b.mp4'],
      ['a1', 'c.pdf'],
    ])
    expect(after[0].obj).toBe(before[1].obj)
    expect(objectsOf(record.id).sort()).toEqual([`${record.id}/${after[0].obj}`, `${record.id}/${after[1].obj}`].sort())
    expect(await read(url, after[1])).toBe(C.body)
    // the removed file is gone from storage
    expect((await errOf(read(url, before[0]))).kind).toBe('not-found')
  })

  it('an update racing another device is redone on the fresh snapshot, without leftovers', async () => {
    const { url, record } = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    const other = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
    const update = store.update.bind(store)
    let raced = false
    store.update = async (...args) => {
      if (!raced) {
        raced = true
        store.update = update
        await other.update(record, snapWith([B], [], 5), pendingOf([B]).pending) // lands first
      }
      return update(...args)
    }
    await service.update(record, snapWith([A, C], [], 6), pendingOf([A, C]).pending)
    const files = filesOf(await open(url))
    expect(files.map((f) => f.name)).toEqual(['a.png', 'c.pdf'])
    expect(objectsOf(record.id)).toHaveLength(2) // B (no longer used) and the first try's uploads are gone
    for (const f of files) expect(await read(url, f)).toMatch(/secret/)
  })

  it('multi-note links carry one file list; changing the notes updates it', async () => {
    const { map, pending } = pendingOf([A, C])
    const notes = [
      { noteId: 'n1', title: '一', doc: docOf(media('att-a')) },
      { noteId: 'n2', title: '二', doc: docOf(media('att-c', 'file'), media('att-a')) },
    ]
    const snapshot = buildMultiShareSnapshot({ notes, sharedAt: 1, linkLabel: () => null, files: map })
    const { url, record } = await service.createMulti({ noteIds: ['n1', 'n2'], snapshot, files: pending })
    const opened = await open(url)
    expect(opened.v === 2 && opened.notes[1].doc.content?.map((n) => n.attrs?.attachmentId)).toEqual(['a1', 'a0'])
    expect(filesOf(opened)).toHaveLength(2)
    const one = pendingOf([A])
    await service.setNotes(record.id, { noteIds: ['n1'], snapshot: buildMultiShareSnapshot({ notes: [notes[0]], sharedAt: 2, linkLabel: () => null, files: one.map }), files: one.pending })
    expect(filesOf(await open(url)).map((f) => f.name)).toEqual(['a.png'])
    expect(objectsOf(record.id)).toHaveLength(1)
  })

  it('protected links: the files need the password (their keys are in the snapshot); changing it re-uploads nothing', async () => {
    const { url, record } = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    await service.setPassword(record.id, '六個字的密碼')
    const objs = objectsOf(record.id)
    expect((await errOf(open(url))).kind).toBe('password-required')
    const f = filesOf(await open(url, '六個字的密碼'))[0]
    expect(await read(url, f)).toBe(A.body)
    await service.setPassword(record.id, '另一個新密碼')
    expect(objectsOf(record.id)).toEqual(objs)
    expect(await read(url, filesOf(await open(url, '另一個新密碼'))[0])).toBe(A.body)
  })

  it('renewing a link moves its files; the old link gets none', async () => {
    const { url, record } = await service.create('n1', snapWith([A, B]), pendingOf([A, B]).pending)
    await service.setPassword(record.id, '六個字的密碼')
    const oldFile = filesOf(await open(url, '六個字的密碼'))[0]
    const renewed = await service.renew(record.id)
    expect(objectsOf(record.id)).toEqual([])
    expect(store.folders.has(record.id)).toBe(false)
    expect((await errOf(read(url, oldFile))).kind).toBe('not-found')
    const files = filesOf(await open(renewed.url, '六個字的密碼'))
    expect(await read(renewed.url, files[0])).toBe(A.body)
    expect(await read(renewed.url, files[1])).toBe(B.body)
  })

  it('stopping a link deletes its files, so their tokens stop working', async () => {
    const one = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    const f = filesOf(await open(one.url))[0]
    await service.stop(one.record.id)
    expect(objectsOf(one.record.id)).toEqual([])
    expect(store.folders.has(one.record.id)).toBe(false)
    expect((await errOf(read(one.url, f))).kind).toBe('not-found')
  })

  it('a file needs its token: knowing the link id and object name is not enough', async () => {
    const { url } = await service.create('n1', snapWith([A, B]), pendingOf([A, B]).pending)
    const [fa, fb] = filesOf(await open(url))
    expect((await errOf(read(url, { ...fa, token: fb.token }))).kind).toBe('not-found')
  })

  it('a write whose answer is lost keeps its files; cleanup later removes only unreferenced ones', async () => {
    const { url, record } = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    const update = store.update.bind(store)
    store.update = async (...args) => {
      await update(...args) // lands on the server…
      throw new ShareError('unknown', 'timeout') // …but the answer is lost
    }
    await errOf(service.update(record, snapWith([B], [], 2), pendingOf([B]).pending))
    store.update = update
    const live = filesOf(await open(url))
    expect(live.map((f) => f.name)).toEqual(['b.mp4'])
    expect(await read(url, live[0])).toBe(B.body) // not deleted
    expect(objectsOf(record.id)).toHaveLength(2) // A is now unreferenced
    now += ORPHAN_FOLDER_GRACE_MS + 1
    await service.cleanupFiles()
    expect(objectsOf(record.id)).toEqual([`${record.id}/${live[0].obj}`])
    expect(await read(url, live[0])).toBe(B.body)
  })

  it('files of links deleted with their note are cleaned up later (not while a link may still be on its way)', async () => {
    const { record } = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    await service.removeForNotes(['n1'])
    expect(objectsOf(record.id)).toHaveLength(1) // the database delete cannot reach storage
    await service.cleanupFiles()
    expect(objectsOf(record.id)).toHaveLength(1) // younger than the grace period
    now += ORPHAN_FOLDER_GRACE_MS + 1
    await service.cleanupFiles()
    expect(objectsOf(record.id)).toEqual([])
    expect(store.folders.size).toBe(0)
  })

  it('the server cannot swap one file for another', async () => {
    const { url, record } = await service.create('n1', snapWith([A, B]), pendingOf([A, B]).pending)
    const [fa, fb] = filesOf(await open(url))
    const ka = `${record.id}/${fa.obj}`
    const kb = `${record.id}/${fb.obj}`
    const a = store.files.get(ka)!
    store.files.set(ka, store.files.get(kb)!)
    store.files.set(kb, a)
    expect((await errOf(read(url, fa))).kind).toBe('invalid')
  })

  it("another account cannot take over a link's folder", async () => {
    const { record } = await service.create('n1', snapWith([A]), pendingOf([A]).pending)
    store.userId = 'u2'
    await expect(store.claimFolder(record.id)).rejects.toBeInstanceOf(ShareError)
    await expect(store.uploadFile(record.id, 'x'.repeat(22), new Uint8Array(30))).rejects.toBeInstanceOf(ShareError)
    await store.releaseFolder(record.id) // does nothing, like Storage under its policies
    await store.deleteFiles(record.id, [...store.files.keys()].map((k) => k.split('/')[1]))
    expect(objectsOf(record.id)).toHaveLength(1)
  })

  it('a link without attachments still works as before (no folder)', async () => {
    const { url, record } = await service.create('n1', snapWith([]), [])
    expect(filesOf(await open(url))).toEqual([])
    expect(store.folders.has(record.id)).toBe(false)
    const renewed = await service.renew(record.id)
    expect(store.folders.size).toBe(0)
    await service.update(renewed.record, snapWith([A], [], 3), pendingOf([A]).pending)
    expect(filesOf(await open(renewed.url))).toHaveLength(1)
  })
})

describe('share attachments: allow-list', () => {
  const key = 'k'.repeat(43)
  const file = (over: Partial<ShareFile> = {}): ShareFile => ({ code: 'a0', obj: 'o'.repeat(22), key, ref: key, name: 'x.png', mime: 'image/png', size: 10, token: 'aa.bb.cc', ...over })

  it('keeps well-formed entries only', () => {
    const out = sanitizeShareFiles([
      file(),
      file({ code: 'a0' }), // repeated
      file({ code: 'a1', obj: '../etc' }),
      file({ code: 'a2', key: 'short' }),
      file({ code: 'a3', size: -1 }),
      file({ code: 'a4', size: MAX_SHARE_FILE_BYTES + 1 }),
      file({ code: 'b5' }),
      { ...file({ code: 'a6' }), name: 'evil\u0000‮.png'.padEnd(400, 'x'), mime: 'text/html; charset=x' },
      file({ code: 'a7', token: 'not a token' }),
      'junk',
    ])
    expect(out.map((f) => f.code)).toEqual(['a0', 'a6'])
    expect(out[1].name.length).toBe(200)
    expect(out[1].name).not.toContain('\u0000')
    expect(out[1].name).not.toContain('\u202e')
    expect(out[1].mime).toBe('application/octet-stream')
    expect(sanitizeShareFiles({ length: 1 })).toEqual([])
  })

  it('caps the total at 50 MB', () => {
    const out = sanitizeShareFiles([0, 1, 2].map((i) => file({ code: `a${i}`, size: 20 * 1024 * 1024 })))
    expect(out).toHaveLength(2)
  })

  it('media survive only when listed, at block level; SVG and unknown types are downloads only', () => {
    const snap = sanitizeSnapshot({
      v: 1,
      title: 't',
      sharedAt: 1,
      files: [file(), file({ code: 'a1', mime: 'image/svg+xml' }), file({ code: 'a2', mime: 'video/x-weird' })],
      doc: docOf(
        { type: 'media', attrs: { attachmentId: 'a0', kind: 'image', width: 99999, onerror: 'x' } },
        media('a1', 'image'),
        media('a2', 'video'),
        media('a9'),
        media('att-real-id'),
        { type: 'paragraph', content: [media('a0')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [media('a0', 'file', 200)] }] },
      ),
    } as AnyShareSnapshot)
    const nodes = snap.v === 1 ? snap.doc.content! : []
    expect(nodes[0]).toEqual({ type: 'media', attrs: { attachmentId: 'a0', kind: 'image', width: null } })
    expect(nodes[1].attrs?.kind).toBe('file')
    expect(nodes[2].attrs?.kind).toBe('file')
    expect(nodes[3].type).toBe('paragraph') // not listed → placeholder
    expect(nodes[4].type).toBe('paragraph')
    expect(JSON.stringify(nodes[5])).not.toContain('media')
    expect(nodes[6].content?.[0].content?.[0]).toEqual({ type: 'media', attrs: { attachmentId: 'a0', kind: 'file', width: 200 } })
  })

  it('without files, media still become the placeholder (older links, and v1 snapshots)', () => {
    const snap = buildShareSnapshot({ title: 't', doc: docOf(media('att-a')), sharedAt: 1, linkLabel: () => null })
    expect(snap.doc.content?.[0].type).toBe('paragraph')
    expect(JSON.stringify(snap)).not.toContain('att-a')
  })
})
