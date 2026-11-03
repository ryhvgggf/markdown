import { describe, expect, it } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import type { PMNode } from '@/core/markdown/types'
import { ATTACHMENT_OMITTED_TEXT, ShareError, buildShareSnapshot, decodeSnapshot, encodeSnapshot, MAX_SNAPSHOT_BYTES } from './snapshot'

const txt = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, ...(marks && { marks }) })
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', attrs: { id: 'b1' }, content })

const labels: Record<string, string> = { n2: '採購流程', 'n2#k1': '採購流程 › 核准層級' }
const linkLabel = (noteId: string, blockId: string | null) => labels[blockId ? `${noteId}#${blockId}` : noteId] ?? null

describe('buildShareSnapshot', () => {
  it('keeps the title, time and ordinary content', () => {
    const doc: PMNode = { type: 'doc', content: [para(txt('hi ', [{ type: 'bold' }]), { type: 'tag', attrs: { name: 'sap' } })] }
    const s = buildShareSnapshot({ title: '筆記', doc, sharedAt: 123, linkLabel })
    expect(s).toEqual({ v: 1, title: '筆記', sharedAt: 123, doc })
  })

  it('turns links to other notes into plain text, keeping their marks', () => {
    const doc: PMNode = {
      type: 'doc',
      content: [
        para(
          txt('see '),
          { type: 'noteLink', attrs: { noteId: 'n2', blockId: null }, marks: [{ type: 'bold' }] },
          txt(' and '),
          { type: 'noteLink', attrs: { noteId: 'n2', blockId: 'k1' } },
        ),
      ],
    }
    const s = buildShareSnapshot({ title: 't', doc, sharedAt: 1, linkLabel })
    expect(s.doc.content![0].content).toEqual([
      txt('see '),
      txt('採購流程', [{ type: 'bold' }]),
      txt(' and '),
      txt('採購流程 › 核准層級'),
    ])
    expect(JSON.stringify(s)).not.toContain('n2')
  })

  it('a link to a note that is gone keeps its stored label, or disappears', () => {
    const doc: PMNode = {
      type: 'doc',
      content: [para(txt('a'), { type: 'noteLink', attrs: { noteId: 'gone', blockId: null, label: '舊名' } }, { type: 'noteLink', attrs: { noteId: 'gone2', blockId: null } })],
    }
    const s = buildShareSnapshot({ title: 't', doc, sharedAt: 1, linkLabel })
    expect(s.doc.content![0].content).toEqual([txt('a'), txt('舊名')])
  })

  it('replaces attachments with a placeholder that carries no attachment id, at any depth', () => {
    const media: PMNode = { type: 'media', attrs: { attachmentId: 'att-secret', kind: 'image', width: null } }
    const doc: PMNode = {
      type: 'doc',
      content: [media, { type: 'blockquote', content: [media] }],
    }
    const s = buildShareSnapshot({ title: 't', doc, sharedAt: 1, linkLabel })
    const placeholder = { type: 'paragraph', content: [txt(ATTACHMENT_OMITTED_TEXT, [{ type: 'italic' }])] }
    expect(s.doc.content).toEqual([placeholder, { type: 'blockquote', content: [placeholder] }])
    expect(JSON.stringify(s)).not.toContain('att-secret')
  })

  it('does not change the input', () => {
    const doc: PMNode = { type: 'doc', content: [para({ type: 'noteLink', attrs: { noteId: 'n2', blockId: null } })] }
    const before = JSON.stringify(doc)
    buildShareSnapshot({ title: 't', doc, sharedAt: 1, linkLabel })
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('encodeSnapshot / decodeSnapshot', () => {
  const snap = buildShareSnapshot({ title: '標題', doc: { type: 'doc', content: [para(txt('內容'))] }, sharedAt: 5, linkLabel })

  it('round-trips and compresses', () => {
    const big = buildShareSnapshot({ title: 't', doc: { type: 'doc', content: Array.from({ length: 500 }, () => para(txt('重複的內容 '))) }, sharedAt: 1, linkLabel })
    const bytes = encodeSnapshot(big)
    expect(bytes.length).toBeLessThan(JSON.stringify(big).length / 10)
    expect(decodeSnapshot(bytes)).toEqual(big)
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap)
  })

  it('refuses snapshots over the size limit', () => {
    // incompressible text so the gzip output is over the limit
    const r = new Uint16Array(MAX_SNAPSHOT_BYTES)
    for (let i = 0; i < r.length; i += 32768) crypto.getRandomValues(r.subarray(i, i + 32768))
    let s = ''
    for (let i = 0; i < r.length; i += 8192) s += String.fromCharCode(...Array.from(r.subarray(i, i + 8192), (x) => 0x4e00 + (x % 20000)))
    const huge = buildShareSnapshot({ title: 't', doc: { type: 'doc', content: [para(txt(s))] }, sharedAt: 1, linkLabel })
    expect(() => encodeSnapshot(huge)).toThrow(ShareError)
    try {
      encodeSnapshot(huge)
    } catch (e) {
      expect((e as ShareError).kind).toBe('too-large')
    }
  })

  it('rejects data that is not a snapshot', () => {
    const bad = (v: unknown) => gzipSync(strToU8(JSON.stringify(v)))
    expect(() => decodeSnapshot(new Uint8Array([1, 2, 3]))).toThrow(ShareError)
    expect(() => decodeSnapshot(bad({ v: 2, title: 't', sharedAt: 1, doc: { type: 'doc' } }))).toThrow(ShareError)
    expect(() => decodeSnapshot(bad({ v: 1, title: 3, sharedAt: 1, doc: { type: 'doc' } }))).toThrow(ShareError)
    expect(() => decodeSnapshot(bad({ v: 1, title: 't', sharedAt: 1, doc: { type: 'paragraph' } }))).toThrow(ShareError)
    expect(() => decodeSnapshot(bad({ v: 1, title: 't', sharedAt: 'x', doc: { type: 'doc' } }))).toThrow(ShareError)
  })

  it('refuses to inflate something claiming to be enormous', () => {
    const bytes = encodeSnapshot(snap)
    const forged = bytes.slice()
    new DataView(forged.buffer).setUint32(forged.length - 4, 0xfffffff0, true)
    expect(() => decodeSnapshot(forged)).toThrow(ShareError)
  })
})
