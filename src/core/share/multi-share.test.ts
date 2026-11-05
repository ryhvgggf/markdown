import { beforeEach, describe, expect, it } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryShare } from '@/adapters/share/memory-share'
import { MAX_SHARE_NOTES, ShareError } from '@/adapters/share/types'
import type { PMNode } from '@/core/markdown/types'
import { MAX_NODES, sanitizeShareDoc } from './sanitize'
import { createShareService, openSharedLink } from './share-service'
import { buildMultiShareSnapshot, buildShareSnapshot, decodeSnapshot, encodeSnapshot, sanitizeSnapshot, type MultiShareSnapshot } from './snapshot'

/** Multi-note links (claude/multi-share-plan.md, part 1): snapshot v2, its allow-list, and the owner/viewer flows. */

const txt = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, ...(marks && { marks }) })
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content })
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content })
const link = (noteId: string, blockId: string | null = null, label?: string, marks?: PMNode['marks']): PMNode => ({
  type: 'noteLink',
  attrs: { noteId, blockId, ...(label !== undefined && { label }) },
  ...(marks && { marks }),
})
const titles: Record<string, string> = { REAL_A: 'A 篇', REAL_B: 'B 篇', REAL_C: 'C 篇', REAL_OUT: '沒分享的' }
const linkLabel = (id: string, blockId: string | null) => (titles[id] ? (blockId ? `${titles[id]} › 段落` : titles[id]) : null)
const multi = (ids: string[], docs: Record<string, PMNode> = {}, at = 1) =>
  buildMultiShareSnapshot({ notes: ids.map((noteId) => ({ noteId, title: titles[noteId] ?? noteId, doc: docs[noteId] ?? doc(para(txt(`內容 ${titles[noteId] ?? ''}`))) })), sharedAt: at, linkLabel })
const gz = (v: unknown) => gzipSync(strToU8(JSON.stringify(v)))
const errKind = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    expect(e).toBeInstanceOf(ShareError)
    return (e as ShareError).kind
  }
  throw new Error('expected a ShareError')
}

describe('buildMultiShareSnapshot', () => {
  it('gives notes in-snapshot codes in order; real note ids never appear in the snapshot', () => {
    const s = multi(['REAL_A', 'REAL_C', 'REAL_B'], {
      REAL_A: doc(para(txt('見 '), link('REAL_B', 'blk-1'), txt(' 與 '), link('REAL_OUT'), txt(' 與 '), link('REAL_GONE', null, '舊名'))),
    })
    expect(s.v).toBe(2)
    expect(s.notes.map((n) => [n.id, n.title])).toEqual([['n0', 'A 篇'], ['n1', 'C 篇'], ['n2', 'B 篇']])
    expect(s.notes[0].doc).toEqual(
      doc(para(txt('見 '), link('n2', 'blk-1', 'B 篇 › 段落'), txt(' 與 '), txt('沒分享的'), txt(' 與 '), txt('舊名'))),
    )
    expect(JSON.stringify(s)).not.toMatch(/REAL_/)
  })

  it('keeps the marks of a kept link; attachments become the placeholder', () => {
    const s = multi(['REAL_A', 'REAL_B'], { REAL_A: doc(para(link('REAL_B', null, undefined, [{ type: 'bold' }])), { type: 'media', attrs: { id: 'secret-attachment-id' } }) })
    expect(s.notes[0].doc.content?.[0]).toEqual(para(link('n1', null, 'B 篇', [{ type: 'bold' }])))
    expect(JSON.stringify(s.notes[0].doc)).toContain('附件未包含')
    expect(JSON.stringify(s)).not.toContain('secret-attachment-id')
  })

  it('refuses an empty, repeating or too long list', () => {
    expect(() => multi([])).toThrow(ShareError)
    expect(() => multi(['REAL_A', 'REAL_A'])).toThrow(ShareError)
    expect(() => multi(Array.from({ length: MAX_SHARE_NOTES + 1 }, (_, i) => `x${i}`))).toThrow(ShareError)
    expect(multi(Array.from({ length: MAX_SHARE_NOTES }, (_, i) => `x${i}`)).notes).toHaveLength(MAX_SHARE_NOTES)
  })
})

describe('sanitize (multi-note)', () => {
  const targets = new Set(['n0', 'n1'])

  it('keeps links only to in-snapshot codes, with a valid block id and a label', () => {
    const out = sanitizeShareDoc(
      doc(
        para(
          link('n1', 'b-1', 'ok'),
          link('n7', null, '不在這份'),
          link('n0', 'bad id with spaces', '壞區塊'),
          link('n0', null, ''),
          { type: 'noteLink', attrs: { noteId: 'n0', blockId: { evil: 1 }, label: '物件' } },
          { type: 'noteLink', attrs: { noteId: 'n0', label: 'x', onclick: 'alert(1)', href: 'javascript:1' } },
        ),
      ),
      { linkTargets: targets },
    )
    expect(out).toEqual(doc(para(link('n1', 'b-1', 'ok'), txt('不在這份'), txt('壞區塊'), txt('物件'), link('n0', null, 'x'))))
  })

  it('without targets (v1) every link is plain text, as before', () => {
    expect(sanitizeShareDoc(doc(para(link('n0', null, 'x'))))).toEqual(doc(para(txt('x'))))
  })

  it('inside a code block a link is plain text without marks', () => {
    const out = sanitizeShareDoc(doc({ type: 'codeBlock', content: [link('n0', null, 'x', [{ type: 'bold' }])] }), { linkTargets: targets })
    expect(out).toEqual(doc({ type: 'codeBlock', content: [txt('x')] }))
  })

  it('caps a long label', () => {
    const out = sanitizeShareDoc(doc(para(link('n0', null, 'x'.repeat(10_000)))), { linkTargets: targets })
    expect((out.content![0].content![0].attrs!.label as string).length).toBe(2000)
  })

  it('shares one node budget across all notes of a snapshot', () => {
    const big = doc(...Array.from({ length: MAX_NODES / 2 }, () => para()))
    const s = sanitizeSnapshot<MultiShareSnapshot>({ v: 2, sharedAt: 1, notes: [0, 1, 2].map((i) => ({ id: `n${i}`, title: 't', doc: big })) })
    const count = (n: PMNode): number => 1 + (n.content ?? []).reduce((a, c) => a + count(c), 0)
    const total = s.notes.reduce((a, n) => a + count(n.doc) - 1, 0)
    expect(total).toBeLessThanOrEqual(MAX_NODES + 3) // the empty notes get one paragraph each
    expect(s.notes[2].doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})

describe('decodeSnapshot (v1 and v2)', () => {
  it('round-trips v2 and still reads v1', () => {
    const v2 = multi(['REAL_A', 'REAL_B'])
    expect(decodeSnapshot(encodeSnapshot(v2))).toEqual(v2)
    const v1 = buildShareSnapshot({ title: 't', doc: doc(para(txt('a'))), sharedAt: 2, linkLabel: () => null })
    expect(decodeSnapshot(encodeSnapshot(v1))).toEqual(v1)
  })

  it('drops unknown top-level fields', () => {
    expect(decodeSnapshot(gz({ v: 2, sharedAt: 1, extra: 'x', notes: [{ id: 'n0', title: 't', doc: doc(), real: 'REAL_A' }] }))).toEqual({
      v: 2,
      sharedAt: 1,
      notes: [{ id: 'n0', title: 't', doc: doc() }],
    })
  })

  it.each([
    ['no notes', { v: 2, sharedAt: 1, notes: [] }],
    ['notes not a list', { v: 2, sharedAt: 1, notes: {} }],
    ['too many', { v: 2, sharedAt: 1, notes: Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, title: 't', doc: doc() })) }],
    ['a real-looking id', { v: 2, sharedAt: 1, notes: [{ id: 'V1StGXR8_Z5jdHi6B-myT', title: 't', doc: doc() }] }],
    ['a repeated code', { v: 2, sharedAt: 1, notes: [{ id: 'n0', title: 't', doc: doc() }, { id: 'n0', title: 't', doc: doc() }] }],
    ['a title that is not text', { v: 2, sharedAt: 1, notes: [{ id: 'n0', title: 1, doc: doc() }] }],
    ['a doc that is not a doc', { v: 2, sharedAt: 1, notes: [{ id: 'n0', title: 't', doc: { type: 'paragraph' } }] }],
    ['no time', { v: 2, notes: [{ id: 'n0', title: 't', doc: doc() }] }],
    ['an unknown version', { v: 3, sharedAt: 1, notes: [{ id: 'n0', title: 't', doc: doc() }] }],
  ])('rejects %s', (_, value) => {
    expect(() => decodeSnapshot(gz(value))).toThrow(ShareError)
  })
})

describe('multi-note links (service)', () => {
  const ORIGIN = 'https://notes.example'
  let store: MemoryShare
  let service: ReturnType<typeof createShareService>
  let other: ReturnType<typeof createShareService>
  const open = (url: string, password?: string, check?: (d: PMNode) => void) => openSharedLink(store, new URL(url), check, password)

  beforeEach(async () => {
    let now = 1_000_000
    store = new MemoryShare(() => now++)
    const account = { userId: 'u1', vaultId: 'v1', kek: await generateKek() }
    service = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
    other = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
  })

  it('one link opens all its notes; the viewer sees codes only, and the schema check runs on every note', async () => {
    const s = multi(['REAL_A', 'REAL_B'], { REAL_A: doc(para(link('REAL_B'))) })
    const { url, record } = await service.createMulti(['REAL_A', 'REAL_B'], s)
    expect(record).toMatchObject({ noteId: 'REAL_A', noteIds: ['REAL_A', 'REAL_B'] })
    const checked: PMNode[] = []
    const opened = await open(url, undefined, (d) => void checked.push(d))
    expect(opened).toEqual(s)
    expect(checked).toHaveLength(2)
    // a note the editor cannot show fails the whole link, as for one note
    let seen = 0
    const failSecond = () => {
      if (++seen === 2) throw new Error('bad')
    }
    expect(await errKind(open(url, undefined, failSecond))).toBe('unknown')
  })

  it('is listed with every link but not in a note\'s own list', async () => {
    await service.create('REAL_A', buildShareSnapshot({ title: 't', doc: doc(para(txt('x'))), sharedAt: 1, linkLabel }))
    await service.createMulti(['REAL_A', 'REAL_B'], multi(['REAL_A', 'REAL_B']))
    expect((await service.listForNote('REAL_A')).map((r) => r.noteIds)).toEqual([null])
    expect((await service.listAll()).map((r) => r.noteIds)).toEqual([['REAL_A', 'REAL_B'], null])
  })

  it('refuses a note list that does not match the snapshot, or a snapshot of the wrong kind', async () => {
    expect(await errKind(service.createMulti(['REAL_A'], multi(['REAL_A', 'REAL_B'])))).toBe('invalid')
    expect(await errKind(service.createMulti(['REAL_A', 'REAL_A'], multi(['REAL_A', 'REAL_B'])))).toBe('invalid')
    expect(await errKind(service.createMulti([], multi(['REAL_A'])))).toBe('invalid')
    const single = buildShareSnapshot({ title: 't', doc: doc(), sharedAt: 1, linkLabel })
    // @ts-expect-error a v2 snapshot is not a single-note snapshot
    expect(await errKind(service.create('REAL_A', multi(['REAL_A'])))).toBe('invalid')
    const { record } = await service.createMulti(['REAL_A'], multi(['REAL_A']))
    expect(await errKind(service.update(record, single))).toBe('invalid')
    const one = await service.create('REAL_A', single)
    expect(await errKind(service.update(one.record, multi(['REAL_A'])))).toBe('invalid')
    expect(await errKind(service.setNotes(one.record.id, ['REAL_A'], multi(['REAL_A'])))).toBe('invalid')
  })

  it('changing the notes keeps the link, expiry and password, and replaces what it shows', async () => {
    const { url, record } = await service.createMulti(['REAL_A', 'REAL_B'], multi(['REAL_A', 'REAL_B']))
    await service.setExpiry(record.id, 86_400)
    await service.setPassword(record.id, '六個字的密碼')
    const next = multi(['REAL_C', 'REAL_A'], {}, 5)
    const updated = await service.setNotes(record.id, ['REAL_C', 'REAL_A'], next)
    expect(updated).toMatchObject({ id: record.id, noteId: 'REAL_C', noteIds: ['REAL_C', 'REAL_A'] })
    expect(await open(url, '六個字的密碼')).toEqual(next)
    const [listed] = await service.listAll()
    expect(listed).toMatchObject({ noteIds: ['REAL_C', 'REAL_A'], password: { iterations: expect.any(Number) } })
    expect(listed.expiresAt).not.toBeNull()
  })

  it('update snapshot keeps the notes; refused when another device changed them meanwhile', async () => {
    const { url, record } = await service.createMulti(['REAL_A', 'REAL_B'], multi(['REAL_A', 'REAL_B']))
    const fresh = multi(['REAL_A', 'REAL_B'], { REAL_A: doc(para(txt('新的'))) }, 9)
    await service.update(record, fresh)
    expect(await open(url)).toEqual(fresh)
    await other.setNotes(record.id, ['REAL_C'], multi(['REAL_C']))
    // this device still thinks the link shows A and B: writing A and B back would show notes the list no longer has
    expect(await errKind(service.update(record, fresh))).toBe('unknown')
    expect(await open(url)).toEqual(multi(['REAL_C']))
  })

  it('a concurrent snapshot change from another device makes changing the notes retry on the fresh state', async () => {
    const { url, record } = await service.createMulti(['REAL_A', 'REAL_B'], multi(['REAL_A', 'REAL_B']))
    const setNotes = store.setNotes.bind(store)
    let raced = false
    store.setNotes = async (...args) => {
      if (!raced) {
        raced = true
        await other.update(record, multi(['REAL_A', 'REAL_B'], {}, 7))
      }
      return setNotes(...args)
    }
    await service.setNotes(record.id, ['REAL_B'], multi(['REAL_B'], {}, 8))
    expect(await open(url)).toEqual(multi(['REAL_B'], {}, 8))
  })

  it('renewing carries the notes over', async () => {
    const { record } = await service.createMulti(['REAL_A', 'REAL_B'], multi(['REAL_A', 'REAL_B']))
    const renewed = await service.renew(record.id)
    expect(renewed.record.noteIds).toEqual(['REAL_A', 'REAL_B'])
    expect(await open(renewed.url)).toEqual(multi(['REAL_A', 'REAL_B']))
    expect((await service.listAll()).map((r) => r.noteIds)).toEqual([['REAL_A', 'REAL_B']])
  })

  it('removing any of its notes (permanent delete) stops the whole link; other links stay', async () => {
    const m = await service.createMulti(['REAL_A', 'REAL_B', 'REAL_C'], multi(['REAL_A', 'REAL_B', 'REAL_C']))
    const single = await service.create('REAL_C', buildShareSnapshot({ title: 't', doc: doc(), sharedAt: 1, linkLabel }))
    await service.removeForNotes(['REAL_B'])
    expect(await errKind(open(m.url))).toBe('not-found')
    expect(await open(single.url)).toMatchObject({ v: 1 })
  })
})
