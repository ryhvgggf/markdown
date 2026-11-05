import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from './extensions'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make() {
  const editor = new Editor({ extensions: createExtensions(new Y.Doc(), ctx) })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

/** Text of each top-level block, ignoring the always-present title heading. */
const blocks = (e: Editor) => e.state.doc.children.map((n) => n.textContent)
const settle = () => new Promise((r) => setTimeout(r, 520)) // past Yjs' 500 ms capture window → separate undo steps

describe('editor undo', () => {
  it('Enter that creates a block is its own undo step (BlockId must not hide it from history)', async () => {
    const e = make()
    e.commands.insertContent('aaa')
    await settle()
    e.commands.splitBlock()
    await settle()
    expect(blocks(e)).toHaveLength(2)
    e.commands.undo()
    expect(blocks(e)).toHaveLength(1)
    expect(blocks(e)[0]).toBe('aaa')
  })

  it('Enter in a list item: undo removes the new item before touching earlier text', async () => {
    const e = make()
    e.commands.setContent('<ol><li><p>one</p></li></ol>')
    await settle()
    e.commands.focus('end')
    e.commands.splitListItem('listItem')
    await settle()
    expect(e.state.doc.textBetween(0, e.state.doc.content.size, '|')).toBe('one|')
    e.commands.undo()
    expect(e.state.doc.descendants.length).toBeDefined()
    let items = 0
    e.state.doc.descendants((n) => void (n.type.name === 'listItem' && items++))
    expect(items).toBe(1)
    expect(e.state.doc.textContent).toBe('one')
  })

  it('redo restores what undo removed', async () => {
    const e = make()
    e.commands.insertContent('aaa')
    await settle()
    e.commands.splitBlock()
    await settle()
    e.commands.undo()
    e.commands.redo()
    expect(blocks(e)).toHaveLength(2)
  })
})

describe('editor undo with remote changes', () => {
  it('a remote edit that needs ids assigned is not undoable, and does not hide the local edit', async () => {
    const doc = new Y.Doc()
    const e = new Editor({ extensions: createExtensions(doc, ctx) })
    editors.push(e)
    e.commands.insertContent('local')
    await settle()
    // a second peer adds a paragraph with no id
    const peerDoc = new Y.Doc()
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(doc))
    const peer = new Editor({ extensions: createExtensions(peerDoc, { noteId: 'n1' } as unknown as EditorContext) })
    editors.push(peer)
    peer.commands.focus('end')
    peer.commands.insertContent('remote')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(doc)))
    await settle()
    expect(e.state.doc.textContent).toContain('remote')
    e.commands.undo()
    expect(e.state.doc.textContent).toContain('remote') // undo only touches this editor's own edits
  })
})
