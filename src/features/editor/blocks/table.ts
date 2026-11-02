import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { addRowAfter, goToNextCell } from '@tiptap/pm/tables'
import { Table as BaseTable, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import { isComposingEvent } from '../ime'

const noBuiltInTab = { Tab: () => false, 'Shift-Tab': () => false }

/**
 * Tiptap's table view sets a column's `width` when a cell has a `colwidth`, but never takes it off again when
 * the `colwidth` goes away. So after undoing a column drag the cells had no width any more (the document was
 * right) while the column on screen kept the dragged one. This clears such leftovers after every update.
 */
class TableViewWithReset extends TableView {
  update(node: PMNode): boolean {
    const ok = super.update(node)
    if (ok) this.clearStaleWidths(node)
    return ok
  }
  private clearStaleWidths(node: PMNode): void {
    const row = node.firstChild
    if (!row) return
    const cols = this.colgroup.children
    let col = 0
    let anyWidth = false
    for (let i = 0; i < row.childCount; i++) {
      const { colspan, colwidth } = row.child(i).attrs as { colspan: number; colwidth: number[] | null }
      for (let j = 0; j < colspan; j++, col++) {
        const el = cols[col] as HTMLElement | undefined
        if (colwidth?.[j]) anyWidth = true
        else if (el?.style.width) el.style.removeProperty('width')
      }
    }
    if (!anyWidth) this.table.style.width = ''
  }
}

export const Table = BaseTable.configure({ resizable: true, View: TableViewWithReset }).extend({
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
