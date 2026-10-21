import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make(doc = new Y.Doc(), content?: string) {
  const editor = new Editor({ extensions: createExtensions(doc, ctx), content })
  editors.push(editor)
  return { editor, doc }
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const ids = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.descendants((n) => {
    if (n.attrs.id !== undefined) out.push(n.attrs.id as string)
  })
  return out
}

describe('BlockId', () => {
  it('assigns a 21 char id to new paragraphs', () => {
    const { editor } = make()
    editor.commands.insertContent('hello')
    const [id] = ids(editor)
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/)
  })

  it('gives duplicates (pasted copies) different ids, keeping the first', () => {
    const { editor } = make()
    editor.commands.insertContent([
      { type: 'paragraph', attrs: { id: 'same-id-aaaaaaaaaaaaa' }, content: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph', attrs: { id: 'same-id-aaaaaaaaaaaaa' }, content: [{ type: 'text', text: 'b' }] },
    ])
    const got = ids(editor)
    expect(got.length).toBe(2)
    expect(got[0]).toBe('same-id-aaaaaaaaaaaaa')
    expect(got[1]).not.toBe(got[0])
  })

  it('keeps ids across a Y.Doc round trip', () => {
    const a = make()
    a.editor.commands.insertContent([
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'two' }] },
    ])
    const before = ids(a.editor)
    const doc2 = new Y.Doc()
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(a.doc))
    const b = make(doc2)
    expect(ids(b.editor)).toEqual(before)
  })
})
