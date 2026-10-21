import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'

export type CalloutIcon = 'info' | 'warning' | 'tip'
const ICONS: CalloutIcon[] = ['info', 'warning', 'tip']
const GLYPH: Record<CalloutIcon, string> = { info: 'ℹ️', warning: '⚠️', tip: '💡' }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: () => ReturnType
    }
  }
}

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const icon = (ICONS.includes(node.attrs.icon) ? node.attrs.icon : 'info') as CalloutIcon
  return (
    <NodeViewWrapper className="callout" data-type="callout" data-icon={icon}>
      <button
        type="button"
        className="callout-icon"
        contentEditable={false}
        aria-label="切換提示框圖示"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!editor.isEditable) return
          updateAttributes({ icon: ICONS[(ICONS.indexOf(icon) + 1) % ICONS.length] })
        }}
      >
        {GLYPH[icon]}
      </button>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: 'info',
        parseHTML: (el) => {
          const v = el.getAttribute('data-icon')
          return ICONS.includes(v as CalloutIcon) ? v : 'info'
        },
        renderHTML: (attrs) => ({ 'data-icon': attrs.icon }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addCommands() {
    return {
      insertCallout:
        () =>
        ({ state, dispatch }) => {
          const { callout, paragraph } = state.schema.nodes
          const node = callout.create({ icon: 'info' }, paragraph.create())
          if (!dispatch) return true
          const { $from } = state.selection
          const tr = state.tr
          // Replace an empty paragraph in place; otherwise insert after the current top-level block.
          const emptyPara = $from.parent.type === paragraph && $from.parent.content.size === 0 && $from.depth === 1
          const at = emptyPara ? $from.before() : $from.after(1)
          if (emptyPara) tr.replaceWith(at, $from.after(), node)
          else tr.insert(at, node)
          tr.setSelection(TextSelection.create(tr.doc, at + 2))
          dispatch(tr.scrollIntoView())
          return true
        },
    }
  },
})
