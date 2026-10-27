import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { onIdle } from '@/core/idle'
import { isTyping, useTyping } from '@/features/editor/typing'
import { useActiveEditor } from './active-editor'

export interface OutlineItem {
  id: string
  level: 1 | 2 | 3
  text: string
}

/** Position from the top of the scroll container above which a heading counts as "already read". */
export const READ_LINE = 80
/** Edits settle this long (then wait for idle time) before the outline is recomputed. */
export const OUTLINE_DEBOUNCE_MS = 250

export const reducedMotion = () => document.documentElement.dataset.reduceMotion === 'true'

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
    // Never per keystroke: after a pause, in idle time.
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelIdle: (() => void) | undefined
    const schedule = () => {
      clearTimeout(timer)
      cancelIdle?.()
      timer = setTimeout(() => {
        cancelIdle = onIdle(() => !editor.isDestroyed && refresh())
      }, OUTLINE_DEBOUNCE_MS)
    }
    editor.on('update', schedule)
    return () => {
      editor.off('update', schedule)
      clearTimeout(timer)
      cancelIdle?.()
    }
  }, [editor])

  const container = useMemo(
    () => (editor && !editor.isDestroyed ? editor.view.dom.closest<HTMLElement>('[data-note-scroll]') : null),
    [editor],
  )

  const typing = useTyping((t) => t.typing)
  useEffect(() => {
    if (!editor || editor.isDestroyed || typing) return // typing mode: no layout reads
    let frame = 0
    const compute = () => {
      frame = 0
      if (isTyping()) return
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
  }, [editor, container, items, typing])

  const select = useCallback(
    (id: string) => {
      if (!editor || editor.isDestroyed) return
      let pos = -1
      editor.state.doc.descendants((node, p) => {
        if (pos < 0 && node.type.name === 'heading' && node.attrs.id === id) pos = p
        return pos < 0
      })
      if (pos >= 0) {
        // Caret into the heading and focus NOW (Tiptap's focus() waits a frame; keys typed meanwhile were lost).
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)))
        editor.view.focus()
      }
      editor.view.dom
        .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
      setActiveId(id)
    },
    [editor],
  )

  /** The title: scroll to the top and put the caret at its end. */
  const selectTitle = useCallback(() => {
    container?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
    setActiveId(null)
  }, [container])

  return { items: editor ? items : [], activeId, select, selectTitle }
}
