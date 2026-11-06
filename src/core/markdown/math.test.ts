import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { stripIds } from './__fixtures__/strip-ids'
import { callout, doc, h, li, math, mathBlock, p, quote, table, ul, type J } from './pm-build'
import { serializeNote, type SerializeContext } from './serialize'
import type { PMNode } from './types'

const ctx: SerializeContext = { noteTitle: () => null, headingText: () => null, attachmentPath: () => null, anchoredBlocks: new Set() }
const md = (d: J) => serializeNote(d, ctx)
const back = (d: J) => JSON.parse(JSON.stringify(stripIds(parseMarkdown(md(d)).doc))) as PMNode

describe('formulas in Markdown', () => {
  it('export writes $…$ and $$…$$', () => {
    expect(md(doc(p('式 ', math('E=mc^2'), ' 完')))).toBe('式 $E=mc^2$ 完\n')
    expect(md(doc(mathBlock('a\\\\\nb')))).toBe('$$\na\\\\\nb\n$$\n')
    expect(md(doc(mathBlock('')))).toBe('$$\n$$\n')
    expect(md(doc(h(2, '標題 ', math('x'))))).toBe('## 標題 $x$\n')
  })

  it('an inline formula the importer could not read back is written as inline code', () => {
    expect(md(doc(p(math(' x'))))).toBe('` x`\n')
    expect(md(doc(p(math('a$b'))))).toBe('`a$b`\n')
    expect(md(doc(p(math('a\\$b'))))).toBe('$a\\$b$\n')
    expect(md(doc(p(math('x\\'))))).toBe('`x\\`\n')
  })

  it('a | in a table cell is escaped so the table and the formula survive', () => {
    const d = doc(table([['h']], [[[math('|x| + \\|y\\|')]]]))
    expect(md(d)).toBe('| h |\n| --- |\n| $\\|x\\| + \\\\|y\\\\|$ |\n')
    expect(back(d)).toEqual(JSON.parse(JSON.stringify(stripIds(d as PMNode))))
  })

  it('a digit right after a formula, an even backslash ending and marks round-trip', () => {
    for (const d of [doc(p(math('x'), '2 個')), doc(p(math('a\\\\'))), doc(p({ ...math('b'), marks: [{ type: 'bold' }] }))]) {
      expect(back(d)).toEqual(JSON.parse(JSON.stringify(stripIds(d as PMNode))))
    }
  })

  it('a line that only starts with $$ does not swallow what follows', () => {
    const blocks = (s: string) => (JSON.parse(JSON.stringify(stripIds(parseMarkdown(s).doc))) as PMNode).content!
    expect(blocks('$$x$$ y\n\npara\n\n$$\nz\n$$').map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'mathBlock'])
    expect(blocks('$$x$$ y')[0].content![0]).toEqual({ type: 'mathInline', attrs: { latex: 'x' } })
    expect(blocks('- $$x$$ y\n- b $$')[0].content!.length).toBe(2)
    expect(blocks('line one\n$$5 未閉合').map((b) => b.type)).toEqual(['paragraph'])
  })

  it('a block formula inside a table cell is written inline', () => {
    const t = table(['h'], [['c']])
    t.content![1].content![0].content = [mathBlock('a\nb')]
    expect(md(doc(t))).toBe('| h |\n| --- |\n| $a b$ |\n')
  })

  it('round-trips everywhere a formula can be', () => {
    const d = doc(
      p('行內 ', math('\\frac{1}{2}'), ' 與 ', math('1 + 1')),
      h(1, 'H ', math('x')),
      mathBlock('\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}'),
      ul(li(['項目 ', math('y')], mathBlock('z'))),
      quote(p(math('q')), mathBlock('w')),
      callout('info', mathBlock('c')),
      table([['h ', math('t')]], [['c']]),
    )
    expect(back(d)).toEqual(JSON.parse(JSON.stringify(stripIds(d as PMNode))))
  })
})
