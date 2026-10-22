import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useActiveEditor } from './active-editor'

export interface OutlineItem {
  id: string
  level: 1 | 2 | 3
  text: string
}

/** Position from the top of the scroll container above which a heading counts as "already read". */
export const READ_LINE = 80

export function extractHeadings(doc: PMNode): OutlineItem[] {
  const out: OutlineItem[] = []
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.level <= 3 && node.attrs.id) {
      const text = node.textContent.trim()
      if (text) out.push({ id: node.attrs.id as string, level: node.attrs.level as 1 | 2 | 3, text })
    }
    return node.isTextblock ? false : undefined
  })
  return out
}

export function useOutline(noteId: string) {
  const editor = useActiveEditor((s) => (s.noteId === noteId ? s.editor : null))
  const [items, setItems] = useState<OutlineItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const refresh = () => {
      const next = extractHeadings(editor.state.doc)
      setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    refresh()
    editor.on('update', refresh)
    return () => void editor.off('update', refresh)
  }, [editor])

  const container = useMemo(
    () => (editor && !editor.isDestroyed ? editor.view.dom.closest<HTMLElement>('[data-note-scroll]') : null),
    [editor],
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    let frame = 0
    const compute = () => {
      frame = 0
      const top = container ? container.getBoundingClientRect().top : 0
      let current: string | null = null
      for (const it of items) {
        const el = editor.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(it.id)}"]`)
        if (el && el.getBoundingClientRect().top - top <= READ_LINE) current = it.id
      }
      setActiveId(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute)
    }
    compute()
    const target: HTMLElement | Window = container ?? window
    target.addEventListener('scroll', schedule, { passive: true })
    return () => {
      target.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [editor, container, items])

  const select = useCallback(
    (id: string) => {
      if (!editor || editor.isDestroyed) return
      let pos = -1
      editor.state.doc.descendants((node, p) => {
        if (pos < 0 && node.type.name === 'heading' && node.attrs.id === id) pos = p
        return pos < 0
      })
      if (pos >= 0) editor.chain().setTextSelection(pos + 1).focus(null, { scrollIntoView: false }).run()
      editor.view.dom
        .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [editor],
  )

  return { items: editor ? items : [], activeId, select }
}
