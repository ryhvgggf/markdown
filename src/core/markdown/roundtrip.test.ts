import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { stripIds } from './__fixtures__/strip-ids'
import { a, b, callout, code, codeBlock, doc, h, hl, hr, i, li, media, noteLink, ol, p, quote, s, table, tag, task, tasks, u, ul, type J } from './pm-build'
import { serializeNote, type SerializeContext } from './serialize'
import type { PMNode } from './types'

const TITLES: Record<string, string> = { n1: '另一篇', n2: '第三篇' }
const FILES: Record<string, string> = { img: '附件/圖 1.png', vid: '附件/v.mp4', pdf: '附件/報告.pdf' }
const ctx: SerializeContext = {
  noteTitle: (id) => TITLES[id] ?? null,
  headingText: (n, blk) => (n === 'n1' && blk === 'hd' ? '段落標題' : null),
  attachmentPath: (id) => FILES[id] ?? null,
  anchoredBlocks: new Set(['blk-1']),
}

/** Test stand-in for resolveRefs (Task 7): refs back to links / media by title and path. */
function fakeResolve(n: PMNode): PMNode {
  if (n.type === 'wikiRef') {
    const at = n.attrs as { target: string; heading: string | null; anchor: string | null }
    const id = Object.keys(TITLES).find((k) => TITLES[k] === at.target)!
    return { type: 'noteLink', attrs: { noteId: id, blockId: at.heading ? 'hd' : (at.anchor ?? null) } }
  }
  if (n.type === 'embedRef') {
    const at = n.attrs as { target: string }
    const id = Object.keys(FILES).find((k) => FILES[k] === at.target)!
    return { type: 'media', attrs: { attachmentId: id, kind: id === 'pdf' ? 'file' : id === 'vid' ? 'video' : 'image', width: null } }
  }
  if (!n.content) return n
  // An embed alone in a paragraph is a media block.
  const content = n.content.map(fakeResolve).flatMap((c) => (c.type === 'paragraph' && c.content?.length === 1 && c.content[0].type === 'media' ? [c.content[0]] : [c]))
  return { ...n, content }
}

/** Link target / rel are the editor's defaults (filled in by the schema), not content. */
const clean = (n: PMNode) =>
  JSON.parse(JSON.stringify(stripIds(n), (k, v) => (k === 'target' || k === 'rel' ? undefined : v))) as PMNode

const fixture: J = doc(
  h(1, '大標題'),
  h(2, '中', b('粗'), '標題'),
  h(3, '小標題'),
  p('一般', b('粗體'), i('斜體'), s('刪除'), u('底線'), hl('螢光', '#FFF1A8'), code('code`x'), '與', a('連結', 'https://e.com/p?q=1')),
  p({ type: 'text', text: '外 ', marks: [{ type: 'bold' }] }, { type: 'text', text: '內', marks: [{ type: 'bold' }, { type: 'italic' }] }, '文', b('「引號」'), '字'),
  p('需要跳脫：1. # - > * _ ` [ ] < ~ $ ^ | ==x== &amp; C:\\path #非標籤'),
  { type: 'paragraph', attrs: { id: 'blk-1' }, content: [{ type: 'text', text: '被區塊連結的段落' }] },
  p('第一行', { type: 'hardBreak' }, '- 第二行'),
  p(noteLink('n1'), ' ', noteLink('n1', 'hd'), ' ', noteLink('n2', 'blk-1'), ' ', tag('SAP'), ' ', tag('採購流程')),
  ul(li('項目', ul('子項目', li('孫項目'))), '第二項'),
  ol('一', li('二', ol('二之一'))),
  { type: 'orderedList', attrs: { start: 5 }, content: [li('五'), li('六')] },
  tasks(task(false, '待辦'), task(true, '完成', tasks(task(false, '子待辦')))),
  ul({ type: 'listItem', content: [p('兩段'), p('第二段')] }),
  quote(p('引用'), p('第二段')),
  callout('info', p('資訊')),
  callout('tip', p('提示'), ul('清單')),
  callout('warning', p('警告')),
  codeBlock('ts', 'const a = `x`\n\nfunction f() {}'),
  codeBlock(null, '```\n內含 fence'),
  codeBlock('mermaid', 'graph TD\n  A-->B'),
  table(['名稱', '說明'], [['a', 'x|y'], [['第一行', { type: 'hardBreak' }, '第二行'], b('粗')]]),
  media('img', 'image'),
  media('vid', 'video'),
  media('pdf', 'file'),
  hr(),
  p('結尾'),
)

/** Attributes Markdown cannot hold (spec 6.4). The fixture uses none of them. */
describe('Markdown round trip', () => {
  it('export → import → export is identical, and the document comes back', () => {
    const md1 = serializeNote(fixture, ctx)
    const back = fakeResolve(parseMarkdown(md1).doc)
    const md2 = serializeNote(back, ctx)
    expect(md2).toBe(md1)
    expect(clean(back)).toEqual(clean(fixture))
  })

  it('anchored block keeps its id through the round trip', () => {
    const back = parseMarkdown(serializeNote(fixture, ctx)).doc
    const ids: string[] = []
    const walk = (n: PMNode) => (typeof n.attrs?.id === 'string' && ids.push(n.attrs.id), n.content?.forEach(walk))
    walk(back)
    expect(ids).toContain('blk-1')
  })

  it('plain-text URLs come back as links but the Markdown is unchanged', () => {
    const d = doc(p('網址 https://e.com/a_b 結尾'))
    const md1 = serializeNote(d, ctx)
    expect(serializeNote(fakeResolve(parseMarkdown(md1).doc), ctx)).toBe(md1)
  })

  it('a second round trip of foreign Markdown is stable', () => {
    const foreign = '標題下\n軟換行\n\n* 星號清單\n+ 加號\n\n1) 括號編號\n\nSetext\n===\n\n> [!note] 標題\n> 內容\n'
    const once = serializeNote(fakeResolve(parseMarkdown(foreign).doc), ctx)
    const twice = serializeNote(fakeResolve(parseMarkdown(once).doc), ctx)
    expect(twice).toBe(once)
  })
})
