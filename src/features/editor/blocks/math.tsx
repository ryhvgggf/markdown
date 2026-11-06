import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { InputRule, Node, mergeAttributes, type Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode, type NodeType } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { isComposingEvent } from '../ime'
import { loadKatex, renderMath } from './math-render'

/**
 * Formulas (phase 5): `mathInline` (inside text) and `mathBlock` (a block of its own, block-linkable). The formula is
 * the `latex` attribute — written in an editor of its own and shown with KaTeX — so two devices editing the same
 * formula at once keep the last edit (no character merge).
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      /** A block formula in place of the empty paragraph at the cursor (after the cursor's block otherwise), opened for editing. */
      insertMathBlock: () => ReturnType
      /** An inline formula at the cursor, opened for editing. */
      insertMathInline: () => ReturnType
    }
  }
}

export const isMathNode = (n: PMNode | null | undefined) => n?.type.name === 'mathInline' || n?.type.name === 'mathBlock'

/** The node view at this position opens its formula editor when it mounts (a newly inserted formula). */
const pendingEdit = new WeakMap<Editor, number>()
/** Node views listening for "edit the formula at this position" (Enter on a selected formula). */
const editListeners = new WeakMap<Editor, Set<(pos: number) => void>>()

function requestEdit(editor: Editor, pos: number) {
  pendingEdit.set(editor, pos)
  editListeners.get(editor)?.forEach((f) => f(pos))
}

/** `$x$`: not `$ x$`, `$x $`, `\$x$`, `$$x$`. The rule only sees the closing `$` as it is typed. */
const INLINE_INPUT = /(?:^|[^$\\])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': String(attrs.latex ?? '') }),
  },
}

function MathView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const block = node.type.name === 'mathBlock'
  const latex = String(node.attrs.latex ?? '')
  const pos = () => {
    const p = getPos()
    return typeof p === 'number' ? p : null
  }
  const [editing, setEditing] = useState(() => {
    const p = pos()
    if (p === null || !editor.isEditable || pendingEdit.get(editor) !== p) return false
    pendingEdit.delete(editor)
    return true
  })
  const [draft, setDraft] = useState(latex)
  const done = useRef(false)

  const open = () => {
    if (!editor.isEditable) return
    setDraft(latex)
    done.current = false
    setEditing(true)
  }

  useEffect(() => {
    const listen = (p: number) => {
      if (p !== pos() || !editor.isEditable) return
      pendingEdit.delete(editor)
      open()
    }
    let set = editListeners.get(editor)
    if (!set) editListeners.set(editor, (set = new Set()))
    set.add(listen)
    return () => void set.delete(listen)
  })

  /** Back to the document: the cursor after an inline formula, a block formula selected. */
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    const p = pos()
    if (p === null) return
    const value = save ? draft.trim() : latex
    if (!block && value === '') {
      editor.chain().focus().deleteRange({ from: p, to: p + node.nodeSize }).run()
      return
    }
    if (value !== latex) updateAttributes({ latex: value })
    const chain = editor.chain().focus()
    if (block) chain.setNodeSelection(p).run()
    else chain.setTextSelection(p + node.nodeSize).run()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isComposingEvent(e.nativeEvent)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    } else if (e.key === 'Enter' && (!block || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      finish(true)
    }
  }

  const Tag = block ? 'div' : 'span'
  return (
    <NodeViewWrapper
      as={Tag}
      className={block ? 'math-block' : 'math-inline'}
      data-type={block ? 'math-block' : 'math-inline'}
      data-selected={selected || undefined}
      contentEditable={false}
    >
      {editing ? (
        <Tag className="math-edit">
          {block ? (
            <textarea
              className="math-input"
              aria-label="公式（LaTeX）"
              autoFocus
              spellCheck={false}
              rows={Math.max(2, draft.split('\n').length)}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true)}
            />
          ) : (
            <input
              className="math-input"
              aria-label="公式（LaTeX）"
              autoFocus
              spellCheck={false}
              size={Math.max(4, draft.length + 1)}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true)}
            />
          )}
          {draft.trim() && <Formula latex={draft.trim()} display={block} className="math-preview" />}
        </Tag>
      ) : latex ? (
        <Formula latex={latex} display={block} onClick={open} />
      ) : (
        <Tag className="math-empty" onClick={open}>
          {editor.isEditable ? '點此輸入公式' : ''}
        </Tag>
      )}
    </NodeViewWrapper>
  )
}

/** KaTeX output (its own chunk, loaded on first use); the formula's text until then or when it has an error. */
function Formula({ latex, display, className, onClick }: { latex: string; display: boolean; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const [error, setError] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    el.textContent = latex
    loadKatex().then(
      (katex) => {
        if (live && ref.current === el) setError(!renderMath(katex, latex, el, display))
      },
      () => undefined, // offline before the chunk ever loaded: the text stays
    )
    return () => {
      live = false
    }
  }, [latex, display])
  const Tag = display ? 'div' : 'span'
  return (
    <Tag
      ref={ref as never}
      className={['math-render', error && 'math-error', className].filter(Boolean).join(' ')}
      title={error ? '公式有錯誤' : undefined}
      onClick={onClick}
    />
  )
}

/** In place of the empty paragraph at the cursor when it can be, otherwise after the cursor's block. */
function insertBlockAt(state: EditorState, tr: Transaction, type: NodeType): number | null {
  const { $from } = state.selection
  if ($from.parent.type.spec.code) return null
  const node = type.create({ latex: '' })
  const container = $from.node(-1)
  const index = $from.index(-1)
  if ($from.depth >= 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && container.canReplace(index, index + 1, Fragment.from(node))) {
    tr.replaceWith($from.before(), $from.after(), node)
    return $from.before()
  }
  const at = $from.depth >= 1 ? $from.after() : $from.pos
  if (!tr.doc.resolve(at).parent.canReplaceWith(tr.doc.resolve(at).index(), tr.doc.resolve(at).index(), type)) return null
  tr.insert(at, node)
  return at
}

const editOnEnter = (name: string, editor: Editor) =>
  new Plugin({
    key: new PluginKey(`${name}Enter`),
    props: {
      // Enter on a selected formula opens its editor (instead of replacing it with a new line).
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
        if (isComposingEvent(event, view) || !view.editable) return false
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== name) return false
        requestEdit(editor, sel.from)
        return true
      },
    },
  })

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: 'span[data-type="math-inline"]' }],
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' }), String(node.attrs.latex ?? '')]
  },
  renderText: ({ node }) => `$${String(node.attrs.latex ?? '')}$`,

  addNodeView() {
    return ReactNodeViewRenderer(MathView, { as: 'span' })
  },

  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        find: INLINE_INPUT,
        handler: ({ state, range, match }) => {
          const from = range.from + match[0].length - match[1].length - 2 // the opening `$` (the match may start one character before it)
          state.tr.replaceWith(from, range.to, type.create({ latex: match[1] }))
        },
      }),
    ]
  },

  addCommands() {
    return {
      insertMathInline:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const { $from } = state.selection
          if ($from.parent.type.spec.code || !$from.parent.inlineContent) return false
          if (dispatch) {
            const at = state.selection.from
            tr.replaceSelectionWith(this.type.create({ latex: '' }), false)
            pendingEdit.set(editor, at)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [editOnEnter(this.name, this.editor)]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: 'div[data-type="math-block"]' }],
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' }), String(node.attrs.latex ?? '')]
  },
  renderText: ({ node }) => `$$\n${String(node.attrs.latex ?? '')}\n$$`,

  addNodeView() {
    return ReactNodeViewRenderer(MathView)
  },

  addInputRules() {
    const type = this.type
    const editor = this.editor
    return [
      // `$$` typed into an empty paragraph.
      new InputRule({
        find: /^\$\$$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== range.to - range.from) return null
          const container = $from.node(-1)
          const index = $from.index(-1)
          const node = type.create({ latex: '' })
          if (!container.canReplace(index, index + 1, Fragment.from(node))) return null
          const at = $from.before()
          state.tr.replaceWith(at, $from.after(), node)
          pendingEdit.set(editor, at)
        },
      }),
    ]
  },

  addCommands() {
    return {
      insertMathBlock:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const at = insertBlockAt(state, tr, this.type)
          if (at === null) return false
          if (dispatch) {
            tr.setSelection(NodeSelection.create(tr.doc, at))
            pendingEdit.set(editor, at)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [editOnEnter(this.name, this.editor)]
  },
})
