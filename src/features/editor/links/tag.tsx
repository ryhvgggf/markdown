import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { EditorContext } from '../extensions'
import { isComposingEvent } from '../ime'

/**
 * `#name` + space → tag. The `#` must not follow an ASCII letter/digit, `/`, `:`, `.`, `&` or `#`
 * (URLs, anchors, `##`); the name is letters/digits/marks plus inner `_`/`-` and needs at least
 * one letter, so `# ` (heading) and `#1 ` stay text. Code is excluded by Tiptap's input rules.
 */
export const TAG_INPUT = /(?<![A-Za-z0-9_/:#&.])#((?=[\p{N}_-]*\p{L})[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}_-]*) $/u

/** True when the text before `pos` in its textblock has an unclosed `[[` (a link query in progress). */
function inLinkQuery(textBefore: string): boolean {
  return textBefore.lastIndexOf('[[') > textBefore.lastIndexOf(']]')
}

function TagView({ node, extension, editor, getPos }: ReactNodeViewProps) {
  const name = node.attrs.name as string
  const ctx = (extension.options as TagOptions).ctx
  return (
    <NodeViewWrapper as="span" className="tag-wrapper">
      {/* A button: ProseMirror leaves its events alone (no node selection on mousedown), it is focusable and
          Enter / Space activate it. Ctrl/⌘+click does the same as a click (there is nothing to open in a new tab). */}
      <button
        type="button"
        contentEditable={false}
        data-tag={name}
        aria-label={`搜尋標籤 #${name}`}
        className="tag-pill cursor-pointer rounded-full bg-fill px-1.5 py-px text-[0.9em] text-fg-secondary hover:bg-accent/10 hover:text-fg"
        onMouseDown={(e) => {
          e.preventDefault()
          if (!e.shiftKey) return
          // Shift+click extends the selection over the tag (ProseMirror ignores events on the button itself).
          const pos = getPos()
          if (typeof pos !== 'number') return
          const { state } = editor
          const anchor = state.selection.anchor
          const head = pos >= anchor ? pos + node.nodeSize : pos
          editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)))
          editor.view.focus()
        }}
        onClick={(e) => {
          e.preventDefault()
          // Shift+mouse click extended the selection on mousedown; Shift+Enter (detail 0) still opens search.
          if (e.shiftKey && e.detail > 0) return
          ctx?.onTagClick?.(name)
        }}
      >
        #{name}
      </button>
    </NodeViewWrapper>
  )
}

export type TagOptions = { ctx: EditorContext | null }

export const Tag = Node.create<TagOptions>({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { ctx: null }
  },

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => (el.getAttribute('data-tag') ?? '').toLowerCase(),
        renderHTML: (a) => ({ 'data-tag': a.name as string }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-tag]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), `#${node.attrs.name as string}`]
  },

  renderText({ node }) {
    return `#${node.attrs.name as string}`
  },

  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        find: TAG_INPUT,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
          if (inLinkQuery(before)) return null
          const name = match[1].toLowerCase()
          state.tr.replaceWith(range.from, range.to, [type.create({ name }), state.schema.text(' ')])
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TagView)
  },

  addProseMirrorPlugins() {
    const ctx = this.options.ctx
    const type = this.name
    return [
      new Plugin({
        key: new PluginKey('tagActivate'),
        props: {
          // Enter on a selected tag node opens its search (instead of replacing the tag with a new line).
          handleKeyDown(view, event) {
            if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
            if (isComposingEvent(event, view)) return false
            const sel = view.state.selection
            if (!(sel instanceof NodeSelection) || sel.node.type.name !== type) return false
            ctx?.onTagClick?.(sel.node.attrs.name as string)
            return true
          },
        },
      }),
    ]
  },
})
