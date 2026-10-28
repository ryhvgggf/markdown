import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { isComposingEvent } from '../ime'

/**
 * ArrowRight at the end of styled text (or right after a style was switched on from the / menu) leaves the
 * style without moving: the caret stays, what is typed next is plain. Marks that continue into the next
 * character stay. Once nothing is left to leave, ArrowRight moves as usual.
 */
export const ExitMarks = Extension.create({
  name: 'exitMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('exitMarks'),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'ArrowRight' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
            if (isComposingEvent(event, view)) return false
            const { state } = view
            const { selection } = state
            if (!selection.empty) return false
            const $from = selection.$from
            const active = state.storedMarks ?? $from.marks()
            if (!active.length) return false
            const next = $from.nodeAfter?.marks ?? []
            const keep = active.filter((m) => next.some((n) => n.eq(m)))
            if (keep.length === active.length) return false
            event.preventDefault()
            view.dispatch(state.tr.setStoredMarks(keep))
            return true
          },
        },
      }),
    ]
  },
})
