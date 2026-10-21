import { useEffect } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useUi } from '@/app/ui-store'

const key = new PluginKey<string | null>('blockHighlight')
export const HIGHLIGHT_MS = 1500

/** Node decoration `data-highlight="true"` on the block whose id is set via `setBlockHighlight`. */
export const BlockHighlight = Extension.create({
  name: 'blockHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const next = tr.getMeta(key) as string | null | undefined
            return next === undefined ? value : next
          },
        },
        props: {
          decorations(state) {
            const id = key.getState(state)
            if (!id) return null
            let found: Decoration | null = null
            state.doc.descendants((node, pos) => {
              if (found) return false
              if (node.attrs.id === id) {
                found = Decoration.node(pos, pos + node.nodeSize, { 'data-highlight': 'true' })
                return false
              }
            })
            return found ? DecorationSet.create(state.doc, [found]) : null
          },
        },
      }),
    ]
  },
})

export function setBlockHighlight(editor: Editor, blockId: string | null): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(key, blockId).setMeta('addToHistory', false))
}

/** Scrolls the ui-store's highlighted block into view and flashes it for ~1.5 s, then clears it. */
export function useBlockHighlight(editor: Editor | null): void {
  const blockId = useUi((s) => s.highlightBlockId)
  useEffect(() => {
    if (!editor || !blockId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      const el = editor.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
      if (!el) {
        useUi.getState().clearHighlight()
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setBlockHighlight(editor, blockId)
      timer = setTimeout(() => {
        setBlockHighlight(editor, null)
        if (useUi.getState().highlightBlockId === blockId) useUi.getState().clearHighlight()
      }, HIGHLIGHT_MS)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (timer) {
        clearTimeout(timer)
        setBlockHighlight(editor, null)
      }
    }
  }, [editor, blockId])
}
