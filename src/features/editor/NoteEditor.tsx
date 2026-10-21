import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { NoteDocError } from '@/core/note-doc/cache'
import { createExtensions } from './extensions'
import { registerEditor } from './focus-bridge'
import { FormatToolbar } from './menus/FormatToolbar'
import { DragHandleMenu } from './menus/DragHandleMenu'

type Load = { status: 'loading' } | { status: 'corrupted' } | { status: 'error' } | { status: 'ready'; doc: Y.Doc }

const TOUCH_INTERVAL = 5000

export function NoteEditor({ noteId }: { noteId: string }) {
  const { notes } = useServices()
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let acquired = false
    notes.acquire(noteId).then(
      (doc) => {
        acquired = true
        if (cancelled) notes.release(noteId)
        else setLoad({ status: 'ready', doc })
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ status: e instanceof NoteDocError && e.code === 'corrupted' ? 'corrupted' : 'error' })
      },
    )
    return () => {
      cancelled = true
      if (acquired) notes.release(noteId)
    }
  }, [notes, noteId])

  if (load.status === 'loading') return <p className="p-6 text-center text-sm text-fg-tertiary">載入中…</p>
  if (load.status === 'corrupted') {
    return <p className="p-6 text-center text-fg-secondary">這篇筆記無法讀取。原始資料已保留，其他筆記不受影響。</p>
  }
  if (load.status === 'error') return <p className="p-6 text-center text-fg-secondary">無法開啟這篇筆記。</p>
  return <EditorBody noteId={noteId} doc={load.doc} />
}

function EditorBody({ noteId, doc }: { noteId: string; doc: Y.Doc }) {
  const services = useServices()
  const { vault } = services
  const lastTouch = useRef(0)

  const extensions = useMemo(
    () =>
      createExtensions(doc, {
        vault,
        noteId,
        openNote: (id, blockId) => useUi.getState().openNote(id, blockId),
        searchBlocks: (id, q) => {
          const needle = q.toLowerCase()
          return services.db.blocks
            .where('noteId')
            .equals(id)
            .filter((b) => b.text.toLowerCase().includes(needle))
            .limit(20)
            .toArray()
        },
        db: services.db,
        storage: services.storage,
      }),
    [doc, vault, noteId, services.db, services.storage],
  )

  const editor = useEditor(
    {
      extensions,
      editorProps: { attributes: { class: 'note-editor', 'aria-label': '筆記內容' } },
      onUpdate: ({ transaction }) => {
        if (transaction.getMeta('y-sync$')) return // remote / initial load, not a local edit
        const now = Date.now()
        if (now - lastTouch.current < TOUCH_INTERVAL) return
        lastTouch.current = now
        if (vault.getNote(noteId)) vault.touchNote(noteId)
      },
    },
    [extensions],
  )

  useEffect(() => {
    registerEditor(noteId, editor)
    return () => registerEditor(noteId, null)
  }, [editor, noteId])

  return (
    <div data-note-editor className="px-6 pb-32">
      <EditorContent editor={editor} />
      <FormatToolbar editor={editor} />
      <DragHandleMenu editor={editor} />
    </div>
  )
}
