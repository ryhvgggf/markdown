import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '@/core/markdown/parse'
import { stripIds } from '@/core/markdown/__fixtures__/strip-ids'
import type { PMNode } from '@/core/markdown/types'
import { resolveRefs, type Resolver } from './resolve'

const r: Resolver = {
  note: (t) => ({ 另一篇: 'n1', 第三篇: 'n2' })[t] ?? null,
  heading: (n, t) => (n === 'n1' && t === '段落' ? 'h1' : null),
  block: (n, a) => (n === 'n2' && a === 'abc' ? 'abc' : null),
  attachment: (t) => (t === '附件/a.png' || t === 'a.png' ? { id: 'att', kind: 'image' } : t === 'x.pdf' ? { id: 'pdf', kind: 'file' } : null),
}
const run = (md: string) => resolveRefs(parseMarkdown(md).doc, r)
const body = (d: PMNode) => stripIds(d).content

describe('resolveRefs', () => {
  it('turns links into note and block links', () => {
    const res = run('[[另一篇]] [[另一篇#段落]] [[第三篇#^abc]]\n')
    expect(body(res.doc)).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'noteLink', attrs: { noteId: 'n1', blockId: null } },
          { type: 'text', text: ' ' },
          { type: 'noteLink', attrs: { noteId: 'n1', blockId: 'h1' } },
          { type: 'text', text: ' ' },
          { type: 'noteLink', attrs: { noteId: 'n2', blockId: 'abc' } },
        ],
      },
    ])
    expect(res.unresolved).toEqual([])
  })

  it('an unknown heading still links to the note', () => {
    expect(body(run('[[另一篇#沒有]]').doc)![0].content![0]).toEqual({ type: 'noteLink', attrs: { noteId: 'n1', blockId: null } })
  })

  it('keeps unknown links as their text and reports them; an alias becomes the link name', () => {
    const res = run('[[不存在]] 與 [[另一篇|別名]]')
    expect(body(res.doc)![0].content![0]).toEqual({ type: 'text', text: '[[不存在]]' })
    expect(res.unresolved).toEqual(['[[不存在]]'])
    expect((body(res.doc)![0].content as { type: string; attrs?: { label?: string } }[]).find((n) => n.type === 'noteLink')?.attrs?.label).toBe('別名')
    expect(res.aliased).toEqual([])
  })

  it('an embed alone in a paragraph becomes a media block', () => {
    expect(body(run('![[a.png|300]]').doc)).toEqual([{ type: 'media', attrs: { attachmentId: 'att', kind: 'image', width: 300 } }])
  })

  it('an embed inside text splits the paragraph', () => {
    const res = run('前 ![](附件/a.png) 後')
    expect(body(res.doc)!.map((n) => n.type)).toEqual(['paragraph', 'media', 'paragraph'])
  })

  it('a link to a file attachment is a file block', () => {
    expect(body(run('[報告](x.pdf)').doc)).toEqual([{ type: 'media', attrs: { attachmentId: 'pdf', kind: 'file', width: null } }])
  })

  it('a missing embed leaves a note in the text', () => {
    const res = run('![[nope.png]]')
    expect(body(res.doc)![0].content![0]).toEqual({ type: 'text', text: '（找不到附件：nope.png）' })
    expect(res.missing).toEqual(['nope.png'])
  })

  it('a list item that starts with an embed keeps a leading paragraph', () => {
    const doc = stripIds(run('- ![[a.png]]').doc)
    expect(doc.content![0].content![0].content!.map((n) => n.type)).toEqual(['paragraph', 'media'])
  })
})
