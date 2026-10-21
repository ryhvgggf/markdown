import { Extension } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'
import { isComposingEvent } from '../ime'

const ITEM_TYPES = ['listItem', 'taskItem']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listMoves: {
      moveSubtreeUp: () => ReturnType
      moveSubtreeDown: () => ReturnType
    }
  }
}

/** Depth of the innermost list item containing the selection, or -1. */
function itemDepth(state: EditorState): number {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if (ITEM_TYPES.includes($from.node(d).type.name)) return d
  return -1
}

/** Swap the current list item (with all nested children) with its previous / next sibling. */
function moveSubtree(state: EditorState, dir: -1 | 1, dispatch?: (tr: Transaction) => void): boolean {
  const d = itemDepth(state)
  if (d < 0) return false
  const { $from, from, to } = state.selection
  const list = $from.node(d - 1)
  const index = $from.index(d - 1)
  const otherIndex = index + dir
  if (otherIndex < 0 || otherIndex >= list.childCount) return false
  if (!dispatch) return true

  const item = list.child(index)
  const other = list.child(otherIndex)
  const itemStart = $from.before(d)
  const otherSize = other.nodeSize
  const [start, end, nodes, newItemStart] =
    dir === 1
      ? [itemStart, itemStart + item.nodeSize + otherSize, [other, item], itemStart + otherSize]
      : [itemStart - otherSize, itemStart + item.nodeSize, [item, other], itemStart - otherSize]
  const tr = state.tr.replaceWith(start, end, nodes)
  const delta = newItemStart - itemStart
  tr.setSelection(TextSelection.create(tr.doc, from + delta, to + delta))
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * List keyboard behaviour. Handled in a ProseMirror plugin (not addKeyboardShortcuts) so the
 * IME composition guard can inspect the raw event.
 * - Alt-Shift-ArrowUp/Down: move the item and its subtree among siblings.
 * - Tab / Shift-Tab: indent / outdent the item; children travel with it.
 */
export const ListMoves = Extension.create({
  name: 'listMoves',
  priority: 1000,

  addCommands() {
    return {
      moveSubtreeUp:
        () =>
        ({ state, dispatch }) =>
          moveSubtree(state, -1, dispatch),
      moveSubtreeDown:
        () =>
        ({ state, dispatch }) =>
          moveSubtree(state, 1, dispatch),
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            const d = itemDepth(view.state)
            if (d < 0) return false
            const arrow = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey
            const tab = event.key === 'Tab' && !event.altKey && !event.metaKey && !event.ctrlKey
            const move = arrow && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
            if (!move && !tab) return false
            if (isComposingEvent(event, view)) return tab // swallow Tab so the default list shortcut cannot run mid-composition
            if (move) {
              if (event.key === 'ArrowUp') editor.commands.moveSubtreeUp()
              else editor.commands.moveSubtreeDown()
              return true // also at the boundary: no-op, but no browser default
            }
            const type = view.state.selection.$from.node(d).type.name
            if (event.shiftKey) editor.commands.liftListItem(type)
            else editor.commands.sinkListItem(type)
            return true // never let Tab move focus out of a list
          },
        },
      }),
    ]
  },
})
