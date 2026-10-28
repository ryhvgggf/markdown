import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import type { PMNode } from './types'
import { stripIds } from './__fixtures__/strip-ids'

const clean = (o: unknown) => JSON.parse(JSON.stringify(o)) as PMNode
const blocks = (src: string, opts?: { dialect?: 'v1' }) => clean(stripIds(parseMarkdown(src, opts).doc)).content!
const inline = (src: string) => blocks(src)[0].content!
const t = (text: string, ...marks: string[]) => (marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text })
const para = (...c: unknown[]) => ({ type: 'paragraph', content: c })

describe('parseMarkdown', () => {
  it('headings, #### and deeper become H3', () => {
    expect(blocks('# A\n\n## B\n\n#### D')).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [t('A')] },
      { type: 'heading', attrs: { level: 2 }, content: [t('B')] },
      { type: 'heading', attrs: { level: 3 }, content: [t('D')] },
    ])
  })

  it('inline marks', () => {
    expect(inline('**粗** *斜* ~~刪~~ `碼` <u>底</u> ==螢==')).toEqual([
      t('粗', 'bold'), t(' '), t('斜', 'italic'), t(' '), t('刪', 'strike'), t(' '), t('碼', 'code'), t(' '), t('底', 'underline'), t(' '),
      { type: 'text', text: '螢', marks: [{ type: 'highlight', attrs: { color: '#FFF1A8' } }] },
    ])
  })

  it('bold next to CJK punctuation still works', () => {
    expect(inline('文**「粗」**文')).toEqual([t('文'), t('「粗」', 'bold'), t('文')])
    expect(inline('**粗***斜*')).toEqual([t('粗', 'bold'), t('斜', 'italic')])
  })

  it('links: external URL is a link mark, bare URLs are linkified', () => {
    expect(inline('[說明](https://e.com/a_%28b%29) https://e.com')).toEqual([
      { type: 'text', text: '說明', marks: [{ type: 'link', attrs: { href: 'https://e.com/a_(b)' } }] },
      t(' '),
      { type: 'text', text: 'https://e.com', marks: [{ type: 'link', attrs: { href: 'https://e.com' } }] },
    ])
  })

  it('lists, nesting, start number', () => {
    expect(blocks('- a\n  - b\n- c')).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para(t('a')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(t('b'))] }] }] },
          { type: 'listItem', content: [para(t('c'))] },
        ],
      },
    ])
    expect(blocks('3. x')[0]).toEqual({ type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para(t('x'))] }] })
  })

  it('task lists', () => {
    expect(blocks('- [ ] 買\n- [x] 做')).toEqual([
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [para(t('買'))] },
          { type: 'taskItem', attrs: { checked: true }, content: [para(t('做'))] },
        ],
      },
    ])
  })

  it('quote, callouts with types and titles', () => {
    expect(blocks('> 引')).toEqual([{ type: 'blockquote', content: [para(t('引'))] }])
    expect(blocks('> [!info]\n> i')).toEqual([{ type: 'callout', attrs: { icon: 'info' }, content: [para(t('i'))] }])
    expect(blocks('> [!success]\n> s')[0].attrs).toEqual({ icon: 'tip' })
    expect(blocks('> [!danger]- 小心\n> d')).toEqual([
      { type: 'callout', attrs: { icon: 'warning' }, content: [para(t('小心', 'bold')), para(t('d'))] },
    ])
    expect(blocks('> [!faq]\n> q')[0].attrs).toEqual({ icon: 'info' })
  })

  it('v1 :::quote only in the v1 dialect', () => {
    expect(blocks(':::quote\n引言\n:::', { dialect: 'v1' })).toEqual([{ type: 'blockquote', content: [para(t('引言'))] }])
    expect(blocks(':::quote\n引言\n:::')[0].type).toBe('paragraph')
  })

  it('code blocks, mermaid and math keep their text', () => {
    expect(blocks('```ts\nconst a = 1\n```')).toEqual([{ type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1')] }])
    expect(blocks('```mermaid\ngraph TD\n```')[0].attrs).toEqual({ language: 'mermaid' })
    expect(blocks('$$\nE=mc^2\n$$')).toEqual([{ type: 'codeBlock', attrs: { language: 'math' }, content: [t('E=mc^2')] }])
    expect(inline('質能 $E=mc^2$ 式')).toEqual([t('質能 '), t('E=mc^2', 'code'), t(' 式')])
    expect(inline('$5 與 $6')).toEqual([t('$5 與 $6')])
  })

  it('tables with <br> and escaped pipes', () => {
    expect(blocks('| h | i |\n| --- | --- |\n| a<br>b | x\\|y |')).toEqual([
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(t('h'))] }, { type: 'tableHeader', content: [para(t('i'))] }] },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [para(t('a'), { type: 'hardBreak' }, t('b'))] },
              { type: 'tableCell', content: [para(t('x|y'))] },
            ],
          },
        ],
      },
    ])
  })

  it('horizontal rule and tags', () => {
    expect(blocks('---')).toEqual([{ type: 'horizontalRule' }])
    expect(inline('看 #SAP 與 C#')).toEqual([t('看 '), { type: 'tag', attrs: { name: 'SAP' } }, t(' 與 C#')])
  })

  it('wiki links and embeds become refs', () => {
    expect(inline('[[A]] [[A#段落]] [[A#^x-1]] [[A|b]]')).toEqual([
      { type: 'wikiRef', attrs: { target: 'A', heading: null, anchor: null, alias: null, width: null, raw: '[[A]]' } },
      t(' '),
      { type: 'wikiRef', attrs: { target: 'A', heading: '段落', anchor: null, alias: null, width: null, raw: '[[A#段落]]' } },
      t(' '),
      { type: 'wikiRef', attrs: { target: 'A', heading: null, anchor: 'x-1', alias: null, width: null, raw: '[[A#^x-1]]' } },
      t(' '),
      { type: 'wikiRef', attrs: { target: 'A', heading: null, anchor: null, alias: 'b', width: null, raw: '[[A|b]]' } },
    ])
    expect(inline('![[圖.png|300]]')).toEqual([
      { type: 'embedRef', attrs: { target: '圖.png', heading: null, anchor: null, alias: null, width: 300, raw: '![[圖.png|300]]' } },
    ])
    expect(inline('![a](附件/a%20b.png)')).toEqual([
      { type: 'embedRef', attrs: { target: '附件/a b.png', heading: null, anchor: null, alias: 'a', width: null, raw: '![a](附件/a%20b.png)' } },
    ])
    expect(inline('[報告](附件/報告.pdf)')[0]).toMatchObject({ type: 'embedRef', attrs: { target: '附件/報告.pdf', alias: '報告' } })
    expect(inline('[另一篇](資料夾/另一篇.md)')[0]).toMatchObject({ type: 'wikiRef', attrs: { target: '另一篇', alias: '另一篇' } })
  })

  it('keeps a trailing ^anchor as the block id', () => {
    const { doc } = parseMarkdown('文字 ^abc-1\n')
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { id: 'abc-1' }, content: [{ type: 'text', text: '文字' }] })
  })

  it('a ^anchor line gives its id to the block before it', () => {
    const { doc } = parseMarkdown('```js\nx\n```\n\n^code1\n')
    expect(doc.content).toHaveLength(1)
    expect(doc.content![0].attrs?.id).toBe('code1')
  })

  it('anchor on a list item line belongs to the item', () => {
    const { doc } = parseMarkdown('- a ^it1\n')
    expect(doc.content![0].content![0].attrs?.id).toBe('it1')
  })

  it('escaped ^ is text', () => {
    expect(inline('文字 \\^abc')).toEqual([t('文字 ^abc')])
  })

  it('hard breaks and soft breaks become line breaks', () => {
    expect(inline('a\\\nb')).toEqual([t('a'), { type: 'hardBreak' }, t('b')])
    expect(inline('a\nb')).toEqual([t('a'), { type: 'hardBreak' }, t('b')])
  })

  it('CRLF and BOM parse the same as LF', () => {
    const lf = '# 標題\n\n- a\n- b\n'
    expect(stripIds(parseMarkdown('\ufeff' + lf.replace(/\n/g, '\r\n')).doc)).toEqual(stripIds(parseMarkdown(lf).doc))
  })

  it('frontmatter tags and dates', () => {
    const r = parseMarkdown('---\ntags: [a, b]\ncreated: 2024-01-02\n---\n正文')
    expect(r.tags).toEqual(['a', 'b'])
    expect(r.created).toBe(Date.parse('2024-01-02'))
    expect(clean(stripIds(r.doc)).content).toEqual([para(t('正文'))])
    expect(parseMarkdown('---\ntags:\n  - x\n---\n').tags).toEqual(['x'])
    expect(clean(stripIds(parseMarkdown('---\n\na\n\n---\n').doc)).content![0].type).toBe('horizontalRule')
  })

  it('footnotes are kept as text at the end', () => {
    const r = parseMarkdown('正文[^1]\n\n[^1]: 說明 文字')
    expect(clean(stripIds(r.doc)).content).toEqual([para(t('正文[^1]')), para(t('註腳', 'bold')), para(t('[^1]: 說明 文字'))])
    expect(r.lossy).toContain('註腳')
  })

  it('unknown HTML, ~sub~ and ^sup^ stay as text and are reported', () => {
    const r = parseMarkdown('<span>x</span> H~2~O x^2^')
    expect(clean(stripIds(r.doc)).content).toEqual([para(t('<span>x</span> H~2~O x^2^'))])
    expect(r.lossy).toEqual(expect.arrayContaining(['HTML', '下標', '上標']))
  })

  it('empty input is a document with one empty paragraph; every block has an id', () => {
    expect(blocks('')).toEqual([{ type: 'paragraph' }])
    const { doc } = parseMarkdown('- a\n\n> b')
    const ids: unknown[] = []
    const walk = (n: PMNode) => {
      if (['bulletList', 'listItem', 'paragraph', 'blockquote'].includes(n.type)) ids.push(n.attrs?.id)
      n.content?.forEach(walk)
    }
    walk(doc)
    expect(ids.every((x) => typeof x === 'string')).toBe(true)
  })

  it('list item starting with a code block gets an empty first paragraph', () => {
    expect(blocks('- ```\n  x\n  ```')[0].content![0].content![0]).toEqual({ type: 'paragraph' })
  })
})
