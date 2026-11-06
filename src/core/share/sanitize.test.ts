import { describe, expect, it } from 'vitest'
import type { PMNode } from '@/core/markdown/types'
import { ATTACHMENT_OMITTED_TEXT, MAX_DEPTH, sanitizeShareDoc } from './sanitize'

const txt = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, ...(marks && { marks }) })
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', attrs: { id: 'b1' }, content })
const doc = (...content: unknown[]) => ({ type: 'doc', content })

describe('sanitizeShareDoc', () => {
  it('leaves ordinary content untouched', () => {
    const d = doc(
      { type: 'heading', attrs: { id: 'h', level: 2 }, content: [txt('標題', [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#C62828' } }])] },
      para(txt('see', [{ type: 'link', attrs: { href: 'https://a.example/x?y=1' } }]), { type: 'tag', attrs: { name: 'sap' } }),
      { type: 'codeBlock', attrs: { id: 'c', language: 'sql' }, content: [txt('select 1')] },
      { type: 'callout', attrs: { id: 'k', icon: 'tip' }, content: [para(txt('x', [{ type: 'highlight', attrs: { color: '#FFF1A8' } }]))] },
      { type: 'orderedList', attrs: { id: 'o', start: 3, type: null, listStyle: 'auto' }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [para(txt('a'))] }] },
      { type: 'taskList', attrs: { id: 't' }, content: [{ type: 'taskItem', attrs: { id: 'ti', checked: true }, content: [para(txt('b'))] }] },
      {
        type: 'table',
        attrs: { id: 'tb' },
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'center' }, content: [para(txt('c'))] }] }],
      },
      { type: 'horizontalRule', attrs: { id: 'hr' } },
    )
    expect(sanitizeShareDoc(d)).toEqual(d)
  })

  it('keeps formulas (text only, in a place the schema allows)', () => {
    const m = (latex: unknown, extra: Record<string, unknown> = {}) => ({ type: 'mathInline', attrs: { latex, ...extra } })
    const out = sanitizeShareDoc(
      doc(
        para(txt('a'), m('x^2', { onclick: 'x()' }), m(42), m('y'.repeat(10_001))),
        { type: 'mathBlock', attrs: { id: 'mb', latex: '\\href{javascript:alert(1)}{x}', style: 'x' } },
        { type: 'mathBlock', attrs: { id: 'bad id!', latex: 'z' } },
        m('top-level inline'),
        { type: 'codeBlock', attrs: { id: 'c', language: null }, content: [m('in code')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(txt('i')), { type: 'mathBlock', attrs: { latex: 'w' } }] }] },
        para({ type: 'mathBlock', attrs: { latex: 'inline place' } }),
      ),
    )
    expect(out).toEqual(
      doc(
        para(txt('a'), m('x^2')),
        { type: 'mathBlock', attrs: { id: 'mb', latex: '\\href{javascript:alert(1)}{x}' } },
        { type: 'mathBlock', attrs: { latex: 'z' } },
        { type: 'codeBlock', attrs: { id: 'c', language: null } },
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(txt('i')), { type: 'mathBlock', attrs: { latex: 'w' } }] }] },
        { type: 'paragraph', attrs: { id: 'b1' } },
      ),
    )
  })

  it('drops block and mark types it does not know, and ignores extra attributes', () => {
    const out = sanitizeShareDoc(
      doc(
        { type: 'script', content: [txt('alert(1)')] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        { type: 'paragraph', attrs: { id: 'p', onclick: 'x()', style: 'color:red' }, content: [txt('ok', [{ type: 'fancy' }, { type: 'bold', attrs: { onmouseover: 'x()' } }])] },
      ),
    )
    expect(out).toEqual(doc({ type: 'paragraph', attrs: { id: 'p' }, content: [txt('ok', [{ type: 'bold' }])] }))
  })

  it('only keeps http(s) and mailto links', () => {
    const link = (href: unknown) => sanitizeShareDoc(doc(para(txt('x', [{ type: 'link', attrs: { href } }]))))
    const marksOf = (d: PMNode) => d.content![0].content![0].marks
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>', 'vbscript:x', '//evil.example', 'evil.example', 'https://a b', 'https://a\nb', 1, null, 'https://' + 'a'.repeat(5000)]) {
      expect(marksOf(link(bad)), String(bad)).toBeUndefined()
    }
    expect(marksOf(link('mailto:a@b.example'))).toEqual([{ type: 'link', attrs: { href: 'mailto:a@b.example' } }])
    expect(marksOf(link('HTTP://a.example'))).toBeDefined()
  })

  it('only keeps colours from the editor palette', () => {
    const marks = (m: PMNode['marks']) => sanitizeShareDoc(doc(para(txt('x', m)))).content![0].content![0].marks
    expect(marks([{ type: 'textStyle', attrs: { color: 'red; background:url(//e.example)' } }])).toBeUndefined()
    expect(marks([{ type: 'textStyle', attrs: { color: '#123456' } }])).toBeUndefined()
    expect(marks([{ type: 'highlight', attrs: { color: 'var(--x)' } }])).toBeUndefined()
    expect(marks([{ type: 'highlight', attrs: { color: '#CDEFD3' } }])).toEqual([{ type: 'highlight', attrs: { color: '#CDEFD3' } }])
  })

  it('turns attachments into the placeholder and note links into plain text', () => {
    const out = sanitizeShareDoc(
      doc(
        { type: 'media', attrs: { id: 'm', attachmentId: 'att-secret', kind: 'image', width: 200 } },
        para(txt('a'), { type: 'noteLink', attrs: { noteId: 'n-secret', blockId: 'b-secret', label: '另一篇' }, marks: [{ type: 'bold' }] }, { type: 'noteLink', attrs: { noteId: 'x' } }),
      ),
    )
    expect(out.content![0]).toEqual({ type: 'paragraph', content: [txt(ATTACHMENT_OMITTED_TEXT, [{ type: 'italic' }])] })
    expect(out.content![1].content).toEqual([txt('a'), txt('另一篇', [{ type: 'bold' }])])
    expect(JSON.stringify(out)).not.toMatch(/secret/)
  })

  it('rejects out-of-range or wrongly typed attribute values', () => {
    const out = sanitizeShareDoc(
      doc(
        { type: 'heading', attrs: { id: '<img src=x onerror=1>', level: 99 }, content: [txt('h')] },
        { type: 'codeBlock', attrs: { language: '"><script>' }, content: [txt('c', [{ type: 'bold' }])] },
        { type: 'callout', attrs: { icon: 'skull' }, content: [para()] },
      ),
    )
    expect(out.content![0]).toEqual({ type: 'heading', content: [txt('h')] })
    expect(out.content![1]).toEqual({ type: 'codeBlock', content: [txt('c')] }) // marks are not allowed in code
    expect(out.content![2].attrs).toBeUndefined()
  })

  it('drops containers that end up empty, and never returns an empty document', () => {
    expect(sanitizeShareDoc(doc({ type: 'bulletList', content: [{ type: 'unknown' }] }))).toEqual(doc({ type: 'paragraph' }))
    expect(sanitizeShareDoc(doc({ type: 'blockquote', content: [{ type: 'unknown' }] }))).toEqual(doc({ type: 'blockquote', content: [{ type: 'paragraph' }] }))
  })

  it('survives garbage, deep nesting and huge fan-out', () => {
    for (const bad of [null, undefined, 1, 'x', [], {}, { type: 'paragraph' }, { type: 'doc' }, { type: 'doc', content: 'x' }, doc(null, 1, 'x', [])]) {
      expect(sanitizeShareDoc(bad)).toEqual(doc({ type: 'paragraph' }))
    }
    let deep: unknown = para(txt('bottom'))
    for (let i = 0; i < 5000; i++) deep = { type: 'blockquote', content: [deep] }
    const out = JSON.stringify(sanitizeShareDoc(doc(deep)))
    expect(out).not.toContain('bottom')
    expect((out.match(/blockquote/g) ?? []).length).toBeLessThanOrEqual(MAX_DEPTH + 1)
  })

  it('does not mutate its input', () => {
    const d = doc(para(txt('x', [{ type: 'link', attrs: { href: 'javascript:1' } }])))
    const before = JSON.stringify(d)
    sanitizeShareDoc(d)
    expect(JSON.stringify(d)).toBe(before)
  })
})
