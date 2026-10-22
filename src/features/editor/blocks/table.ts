import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { addRowAfter, goToNextCell } from '@tiptap/pm/tables'
import { Table as BaseTable, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { isComposingEvent } from '../ime'

const noBuiltInTab = { Tab: () => false, 'Shift-Tab': () => false }

export const Table = BaseTable.configure({ resizable: true }).extend({
  addKeyboardShortcuts() {
    // Tab / Shift-Tab are handled by TableTab (composition-guarded, ahead of the list handler).
    return { ...this.parent?.(), ...noBuiltInTab }
  },
})

export { TableRow, TableHeader, TableCell }

/**
 * Tab / Shift-Tab move between cells; Tab in the last cell adds a row and moves into it (Tiptap's default).
 * Wins over list indentation, never runs while composing.
 */
export const TableTab = Extension.create({
  name: 'tableTab',
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return false
            const { $from } = view.state.selection
            let inCell = false
            for (let d = $from.depth; d > 0; d--) {
              const name = $from.node(d).type.name
              if (name === 'codeBlock') return false
              if (name === 'tableCell' || name === 'tableHeader') inCell = true
            }
            if (!inCell || isComposingEvent(event, view)) return false
            const move = goToNextCell(event.shiftKey ? -1 : 1)
            if (!move(view.state, view.dispatch, view) && !event.shiftKey) {
              addRowAfter(view.state, view.dispatch)
              goToNextCell(1)(view.state, view.dispatch, view)
            }
            return true // never let Tab leave the table
          },
        },
      }),
    ]
  },
})
