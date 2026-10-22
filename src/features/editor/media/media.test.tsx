import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import { createExtensions, type EditorContext } from '../extensions'
import { addMedia, MAX_ATTACHMENT_BYTES, MediaError } from './add-media'
import { useBlobUrl } from './use-blob-url'
import { renderHook } from '@testing-library/react'

const png = (name = 'a.png') => new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' })
function bigFile(size: number, type: string): File {
  const f = new File([], 'big.bin', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

let created: string[] = []
let revoked: string[] = []
beforeEach(() => {
  created = []
  revoked = []
  document.elementFromPoint = vi.fn(() => null)
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:mock/${created.length}`
    created.push(u)
    return u
  })
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u))
})
afterEach(cleanup)

async function makeVault() {
  return Vault.open(new MemoryStorage(), 'v1', { channelFactory: () => ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel })
}

describe('addMedia', () => {
  it('rejects files over 100 MB before writing anything', async () => {
    const vault = await makeVault()
    const storage = new MemoryStorage()
    const put = vi.spyOn(storage, 'putBlob')
    const err = await addMedia(bigFile(MAX_ATTACHMENT_BYTES + 1, 'image/png'), { vault, storage }).catch((e) => e)
    expect(err).toBeInstanceOf(MediaError)
    expect(err).toMatchObject({ code: 'too-large', message: '檔案超過 100 MB，無法加入。' })
    expect(put).not.toHaveBeenCalled()
    expect(vault.doc.getMap('attachments').size).toBe(0)
  })
  it('accepts exactly 100 MB', async () => {
    const vault = await makeVault()
    await expect(addMedia(bigFile(MAX_ATTACHMENT_BYTES, 'video/mp4'), { vault, storage: new MemoryStorage() })).resolves.toMatchObject({ kind: 'video' })
  })
  it('rejects unsupported types', async () => {
    const vault = await makeVault()
    const storage = new MemoryStorage()
    const err = await addMedia(new File(['x'], 'a.pdf', { type: 'application/pdf' }), { vault, storage }).catch((e) => e)
    expect(err).toMatchObject({ code: 'unsupported', message: '目前只支援圖片與影片。' })
    expect(vault.doc.getMap('attachments').size).toBe(0)
  })
  it('stores metadata and blob on success', async () => {
    const vault = await makeVault()
    const storage = new MemoryStorage()
    const r = await addMedia(png(), { vault, storage })
    expect(r.kind).toBe('image')
    expect(vault.getAttachment(r.attachmentId)).toMatchObject({ filename: 'a.png', mimeType: 'image/png', size: 4 })
    expect((await storage.getBlob(r.attachmentId))?.size).toBe(4)
  })
  it('removes the metadata and rethrows when putBlob fails', async () => {
    const vault = await makeVault()
    const storage = new MemoryStorage()
    vi.spyOn(storage, 'putBlob').mockRejectedValue(new Error('quota'))
    await expect(addMedia(png(), { vault, storage })).rejects.toThrow('quota')
    expect(vault.doc.getMap('attachments').size).toBe(0)
  })
})

describe('vault attachments', () => {
  it('getAttachment / removeAttachment', async () => {
    const vault = await makeVault()
    const m = vault.addAttachment({ filename: 'f', mimeType: 'image/png', size: 1 })
    expect(vault.getAttachment(m.id)).toEqual(m)
    vault.removeAttachment(m.id)
    expect(vault.getAttachment(m.id)).toBeUndefined()
  })
})

describe('useBlobUrl', () => {
  it('goes loading -> ready, then revokes on unmount', async () => {
    const storage = new MemoryStorage()
    await storage.putBlob('x', new Blob(['1']))
    const { result, unmount } = renderHook(() => useBlobUrl(storage, 'x'))
    expect(result.current).toEqual({ url: null, status: 'loading' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.url).toBe('blob:mock/0')
    unmount()
    expect(revoked).toEqual(['blob:mock/0'])
  })
  it('reports missing blobs and revokes on id change', async () => {
    const storage = new MemoryStorage()
    await storage.putBlob('x', new Blob(['1']))
    const { result, rerender } = renderHook(({ id }) => useBlobUrl(storage, id), { initialProps: { id: 'x' } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    rerender({ id: 'nope' })
    expect(result.current.status).toBe('loading')
    expect(revoked).toEqual(['blob:mock/0'])
    await waitFor(() => expect(result.current).toEqual({ url: null, status: 'missing' }))
  })
})

describe('editor integration', () => {
  let editor: Editor | null = null
  let vault: Vault
  let storage: MemoryStorage
  let errors: string[]
  function Harness() {
    const ctx = { vault, storage, noteId: 'n1', onMediaError: (m: string) => errors.push(m) } as unknown as EditorContext
    const e = useEditor({ extensions: createExtensions(new Y.Doc(), ctx) })
    useEffect(() => {
      editor = e
    }, [e])
    return <EditorContent editor={e} />
  }
  async function setup() {
    vault = await makeVault()
    storage = new MemoryStorage()
    errors = []
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p></p>')
      editor!.commands.focus('end')
    })
  }
  const mediaNodes = () => {
    const out: Record<string, unknown>[] = []
    editor!.state.doc.descendants((n) => {
      if (n.type.name === 'media') out.push(n.attrs)
    })
    return out
  }

  it('inserts media nodes on paste, in order, and renders an img', async () => {
    await setup()
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [png('1.png'), png('2.png')], getData: () => '', types: ['Files'] } })
    })
    await waitFor(() => expect(mediaNodes()).toHaveLength(2))
    expect(mediaNodes()[0]).toMatchObject({ kind: 'image', width: null })
    expect(vault.getAttachment(mediaNodes()[0].attachmentId as string)?.filename).toBe('1.png')
    const img = await screen.findAllByRole('img')
    expect(img).toHaveLength(2)
    expect(img[0]).toHaveAttribute('alt', '1.png')
    expect(editor!.state.doc.lastChild?.type.name).toBe('paragraph')
  })
  it('lets text paste win when the clipboard has an image plus text', async () => {
    await setup()
    await act(async () => {
      fireEvent.paste(editor!.view.dom, {
        clipboardData: { files: [png()], getData: (t: string) => (t === 'text/plain' ? 'hello' : ''), types: ['Files', 'text/plain'] },
      })
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mediaNodes()).toHaveLength(0)
    expect(vault.doc.getMap('attachments').size).toBe(0)
  })
  it('inserts media for "Copy image" (img-only html, no text) but not for html with text', async () => {
    await setup()
    const html = (h: string) => (t: string) => (t === 'text/html' ? h : '')
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [png()], getData: html('<img src="x">'), types: ['Files', 'text/html'] } })
    })
    await waitFor(() => expect(mediaNodes()).toHaveLength(1))
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [png()], getData: html('<p>hi</p>'), types: ['Files', 'text/html'] } })
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mediaNodes()).toHaveLength(1)
  })
  it('keeps the document valid when inserting into an empty list item', async () => {
    await setup()
    await act(async () => {
      editor!.commands.setContent('<ul><li><p></p></li></ul>')
      editor!.commands.focus('end')
    })
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [png()], getData: () => '', types: ['Files'] } })
    })
    await waitFor(() => expect(mediaNodes()).toHaveLength(1))
    expect(() => editor!.state.doc.check()).not.toThrow()
    expect(editor!.state.doc.firstChild?.type.name).toBe('bulletList')
    expect(editor!.state.doc.firstChild?.firstChild?.firstChild?.type.name).toBe('paragraph')
  })
  it('inserts media nodes on drop of files, ignoring drops without files', async () => {
    await setup()
    vi.spyOn(editor!.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 })
    await act(async () => {
      fireEvent.drop(editor!.view.dom, { dataTransfer: { files: [png()], types: ['Files'], getData: () => '' } })
    })
    await waitFor(() => expect(mediaNodes()).toHaveLength(1))
    await act(async () => {
      fireEvent.drop(editor!.view.dom, { dataTransfer: { files: [], types: ['text/plain'], getData: () => 'x' } })
    })
    expect(mediaNodes()).toHaveLength(1)
  })
  it('does not handle file paste while composing', async () => {
    await setup()
    Object.defineProperty(editor!.view, 'composing', { value: true, configurable: true })
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [png()], getData: () => '', types: ['Files'] } })
    })
    expect(mediaNodes()).toHaveLength(0)
    expect(vault.doc.getMap('attachments').size).toBe(0)
  })
  it('reports errors and still inserts the valid files', async () => {
    await setup()
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await act(async () => {
      fireEvent.paste(editor!.view.dom, { clipboardData: { files: [pdf, png()], getData: () => '', types: ['Files'] } })
    })
    await waitFor(() => expect(mediaNodes()).toHaveLength(1))
    expect(errors).toEqual(['目前只支援圖片與影片。'])
  })
  it('shows 找不到這個檔案 for a missing blob', async () => {
    await setup()
    await act(async () => {
      editor!.commands.insertContent({ type: 'media', attrs: { attachmentId: 'ghost', kind: 'image', width: null } })
    })
    expect(await screen.findByText('找不到這個檔案')).toBeInTheDocument()
  })
  it('round-trips through HTML and keeps width', async () => {
    await setup()
    await act(async () => {
      editor!.commands.setContent('<div data-type="media" data-attachment-id="a1" data-kind="video" data-width="320"></div>')
    })
    expect(mediaNodes()).toEqual([expect.objectContaining({ attachmentId: 'a1', kind: 'video', width: 320 })])
  })
})
