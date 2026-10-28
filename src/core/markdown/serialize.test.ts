import { describe, expect, it } from 'vitest'
import {
  a, b, callout, code, codeBlock, color, doc, h, hid, hl, hr, i, li, media, noteLink, ol, p, quote, s, table, tag, task, tasks, u, ul,
  type J,
} from './pm-build'
import { serializeNote, type SerializeContext } from './serialize'

const ctx = (over: Partial<SerializeContext> = {}): SerializeContext => ({
  noteTitle: (id) => ({ n1: '另一篇', n2: '第三篇' })[id] ?? null,
  headingText: (noteId, blockId) => (noteId === 'n1' && blockId === 'h1' ? '段落標題' : null),
  attachmentPath: (id) => ({ img: '附件/a b.png', vid: '附件/v.mp4', pdf: '附件/報告.pdf' })[id] ?? null,
  anchoredBlocks: new Set(),
  ...over,
})
const md = (d: J, c = ctx()) => serializeNote(d, c)

describe('serializeNote', () => {
  it('headings and paragraphs, one blank line between blocks', () => {
    expect(md(doc(h(1, 'A'), h(2, 'B'), h(3, 'C'), p('文字')))).toBe('# A\n\n## B\n\n### C\n\n文字\n')
  })

  it('inline marks', () => {
    expect(md(doc(p(b('粗'), i('斜'), s('刪'), code('碼'), u('底'), hl('螢', '#FFF1A8'), color('色', '#C62828'))))).toBe(
      '**粗***斜*~~刪~~`碼`<u>底</u>==螢==色\n',
    )
  })

  it('nested marks open and close once', () => {
    const bi = { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] }
    const bo = (t: string) => ({ type: 'text', text: t, marks: [{ type: 'bold' }] })
    expect(md(doc(p(bo('a '), bi, bo(' c'))))).toBe('**a *b* c**\n')
  })

  it('moves edge spaces outside of marks', () => {
    expect(md(doc(p('x', b(' 粗 '), 'y')))).toBe('x **粗** y\n')
  })

  it('links: markdown link, bare url when text equals href', () => {
    expect(md(doc(p(a('說明', 'https://e.com/a_(b)'), ' ', a('https://e.com', 'https://e.com'))))).toBe(
      '[說明](https://e.com/a_%28b%29) https://e.com\n',
    )
  })

  it('code spans longer than any backtick run inside', () => {
    expect(md(doc(p(code('a`b'))))).toBe('``a`b``\n')
    expect(md(doc(p(code('`x'))))).toBe('`` `x ``\n')
  })

  it('lists: bullets 2 spaces, ordered 3 spaces, alpha still 1.', () => {
    expect(md(doc(ul(li('a', ul('b')), 'c')))).toBe('- a\n  - b\n- c\n')
    const alpha = { type: 'orderedList', attrs: { listStyle: 'alpha' }, content: [li('x', ol('y'))] }
    expect(md(doc(alpha))).toBe('1. x\n   1. y\n')
  })

  it('ordered list keeps its start number', () => {
    expect(md(doc({ type: 'orderedList', attrs: { start: 3 }, content: [li('x'), li('y')] }))).toBe('3. x\n4. y\n')
  })

  it('task lists', () => {
    expect(md(doc(tasks(task(false, '買'), task(true, '做', tasks(task(false, '子'))))))).toBe('- [ ] 買\n- [x] 做\n  - [ ] 子\n')
  })

  it('list item with two paragraphs', () => {
    expect(md(doc(ul({ type: 'listItem', content: [p('a'), p('b')] })))).toBe('- a\n\n  b\n')
  })

  it('quote and callouts', () => {
    expect(md(doc(quote(p('引'), p('二'))))).toBe('> 引\n>\n> 二\n')
    expect(md(doc(callout('info', p('i'))))).toBe('> [!info]\n> i\n')
    expect(md(doc(callout('tip', p('t'))))).toBe('> [!tip]\n> t\n')
    expect(md(doc(callout('warning', p('w'))))).toBe('> [!warning]\n> w\n')
  })

  it('code blocks with language and a long enough fence', () => {
    expect(md(doc(codeBlock('ts', 'const a = 1\n\nb()')))).toBe('```ts\nconst a = 1\n\nb()\n```\n')
    expect(md(doc(codeBlock(null, 'x\n```\ny')))).toBe('````\nx\n```\ny\n````\n')
  })

  it('tables: <br> for line breaks, escaped pipes', () => {
    const t = table(['名稱', '說明'], [[['a', { type: 'hardBreak' }, 'b'], 'x|y']])
    expect(md(doc(t))).toBe('| 名稱 | 說明 |\n| --- | --- |\n| a<br>b | x\\|y |\n')
  })

  it('table cell with a list is flattened to lines', () => {
    const t: J = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('h')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [ul('a', 'b')] }] },
      ],
    }
    expect(md(doc(t))).toBe('| h |\n| --- |\n| - a<br>- b |\n')
  })

  it('media and file blocks', () => {
    expect(md(doc(media('img', 'image', 300), media('vid', 'video'), media('pdf', 'file')))).toBe(
      '![a b.png](附件/a%20b.png)\n\n![v.mp4](附件/v.mp4)\n\n[報告.pdf](附件/報告.pdf)\n',
    )
    expect(md(doc(media('gone', 'image')))).toBe('（找不到附件）\n')
  })

  it('note, heading and block links; anchors on the linked blocks', () => {
    const d = doc(
      p(noteLink('n1'), ' ', noteLink('n1', 'h1'), ' ', noteLink('n2', 'pX_1'), ' ', noteLink('missing')),
      { type: 'paragraph', attrs: { id: 'para_1' }, content: [{ type: 'text', text: '被連結' }] },
      { ...codeBlock('js', 'x'), attrs: { language: 'js', id: 'code1' } },
    )
    expect(md(d, ctx({ anchoredBlocks: new Set(['para_1', 'code1']) }))).toBe(
      '[[另一篇]] [[另一篇#段落標題]] [[第三篇#^pX-1]] （已刪除的筆記）\n\n被連結 ^para-1\n\n```js\nx\n```\n\n^code1\n',
    )
  })

  it('anchored list item gets the anchor on its line', () => {
    const item: J = { type: 'listItem', attrs: { id: 'it1' }, content: [p('a')] }
    expect(md(doc({ type: 'bulletList', content: [item] }), ctx({ anchoredBlocks: new Set(['it1']) }))).toBe('- a ^it1\n')
  })

  it('tags and horizontal rule', () => {
    expect(md(doc(p('看 ', tag('SAP'), ' 與 ', tag('採購')), hr()))).toBe('看 #SAP 與 #採購\n\n---\n')
  })

  it('hard break inside a paragraph', () => {
    expect(md(doc(p('a', { type: 'hardBreak' }, '- b')))).toBe('a\\\n\\- b\n')
  })

  it('escapes text that would read as syntax', () => {
    const cases: Array<[string, string]> = [
      ['1. 不是清單', '1\\. 不是清單'],
      ['# 不是標題', '\\# 不是標題'],
      ['#不是標籤', '\\#不是標籤'],
      ['- 不是項目', '\\- 不是項目'],
      ['> 不是引用', '\\> 不是引用'],
      ['a*b*c_d_', 'a\\*b\\*c\\_d\\_'],
      ['[[不是連結]]', '\\[\\[不是連結\\]\\]'],
      ['==不是螢光==', '\\==不是螢光\\=='],
      ['~~x~~', '\\~\\~x\\~\\~'],
      ['`x`', '\\`x\\`'],
      ['<u>x</u>', '\\<u>x\\</u>'],
      ['$5 與 $6', '\\$5 與 \\$6'],
      ['&amp;', '\\&amp;'],
      ['A & B', 'A & B'],
      ['C:\\x', 'C:\\\\x'],
      ['文字 ^abc', '文字 \\^abc'],
      ['---', '\\---'],
      ['網址 https://e.com/a_b*c', '網址 https://e.com/a_b*c'],
    ]
    for (const [text, out] of cases) expect(md(doc(p(text)))).toBe(out + '\n')
  })

  it('empty document is an empty file', () => {
    expect(md(doc())).toBe('')
    expect(md(doc(p()))).toBe('')
  })

  it('empty paragraphs between blocks are dropped', () => {
    expect(md(doc(p('a'), p(), p('b')))).toBe('a\n\nb\n')
  })

  it('heading ids do not add anchors (heading links use the text)', () => {
    expect(md(doc(hid('h1', 2, '段落')), ctx({ anchoredBlocks: new Set() }))).toBe('## 段落\n')
  })
})
