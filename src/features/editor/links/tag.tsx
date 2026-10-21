import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { EditorContext } from '../extensions'

/**
 * `#name` + space → tag. The `#` must not follow an ASCII letter/digit, `/`, `:` or `#`
 * (URLs, anchors, `##`); the name is letters/digits/marks plus inner `_`/`-` and needs at least
 * one letter, so `# ` (heading) and `#1 ` stay text. Code is excluded by Tiptap's input rules.
 */
export const TAG_INPUT = /(?<![A-Za-z0-9_/:#&])#((?=[\p{N}_-]*\p{L})[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}_-]*) $/u

/** True when the text before `pos` in its textblock has an unclosed `[[` (a link query in progress). */
function inLinkQuery(textBefore: string): boolean {
  return textBefore.lastIndexOf('[[') > textBefore.lastIndexOf(']]')
}

function TagView({ node, extension }: ReactNodeViewProps) {
  const name = node.attrs.name as string
  const ctx = (extension.options as TagOptions).ctx
  return (
    <NodeViewWrapper as="span" className="tag-wrapper">
      <span
        contentEditable={false}
        data-tag={name}
        className="tag-pill rounded-full bg-fill px-1.5 py-px text-[0.9em] text-fg-secondary"
        onClick={() => ctx?.onTagClick?.(name)}
      >
        #{name}
      </span>
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
})
