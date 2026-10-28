import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { BLOCK_TYPES } from '@/core/blocks'
import { newId } from '@/core/ids'

export { BLOCK_TYPES }

const key = new PluginKey('blockId')

/** Adds an `id` attribute to every block type and keeps ids present and unique. */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-block-id'),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.id ? { 'data-block-id': attrs.id as string } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged) && trs.length > 0) return null
          const seen = new Set<string>()
          const tr = state.tr
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!BLOCK_TYPES.includes(node.type.name)) return
            const id = node.attrs.id as string | null
            if (!id || seen.has(id)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() })
              changed = true
            } else {
              seen.add(id)
            }
          })
          if (!changed) return null
          tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})
