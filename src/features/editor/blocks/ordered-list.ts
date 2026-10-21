import { OrderedList as BaseOrderedList } from '@tiptap/extension-list'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type OrderedStyle = 'decimal' | 'alpha' | 'roman'
export type ListStyle = 'auto' | OrderedStyle

const STYLES: OrderedStyle[] = ['decimal', 'alpha', 'roman']

/** Notion-style cycle: 1. -> a. -> i. -> 1. ... */
export function orderedStyleForDepth(depth: number): OrderedStyle {
  return STYLES[((depth % 3) + 3) % 3]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    orderedListStyle: {
      /** Set the numbering style of the ordered list containing the selection. */
      setListStyle: (style: ListStyle) => ReturnType
    }
  }
}

const key = new PluginKey('orderedListStyle')

/**
 * Depth = number of ANCESTOR list nodes of any kind (bulletList / orderedList / taskList),
 * so a bullet list between two ordered lists still advances the numbering style.
 *
 * The effective style depends on where the list sits, so it is applied with a node decoration
 * (data-list-style on the <ol>) rather than stored in the document: moving or indenting a list
 * re-styles it automatically and the CRDT only ever holds the user's explicit choice.
 */
export const OrderedList = BaseOrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyle: {
        default: 'auto',
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-list-style')
          return v === 'decimal' || v === 'alpha' || v === 'roman' ? v : 'auto'
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.listStyle && attrs.listStyle !== 'auto' ? { 'data-list-style': attrs.listStyle as string } : {},
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setListStyle:
        (style: ListStyle) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name !== 'orderedList') continue
            if (dispatch) {
              const pos = $from.before(d)
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, listStyle: style })
              tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)))
              dispatch(tr)
            }
            return true
          }
          return false
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'orderedList') return
              const $pos = state.doc.resolve(pos)
              let depth = 0
              for (let d = $pos.depth; d >= 0; d--) if ($pos.node(d).type.spec.group?.split(' ').includes('list')) depth++
              const chosen = node.attrs.listStyle as ListStyle
              const effective = chosen === 'auto' || !chosen ? orderedStyleForDepth(depth) : chosen
              decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-list-style': effective }))
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
