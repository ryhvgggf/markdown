import { TaskItem as BaseTaskItem } from '@tiptap/extension-list'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'

/**
 * The checkbox is a separate contentEditable=false element; the text lives in a stable
 * <NodeViewContent/>. Toggling only dispatches a setNodeMarkup transaction, so the view is
 * updated in place (never re-created) and the caret never jumps while typing.
 */
function TaskItemView({ node, editor, getPos, HTMLAttributes }: ReactNodeViewProps) {
  const checked = Boolean(node.attrs.checked)
  return (
    <NodeViewWrapper as="li" {...HTMLAttributes} data-type="taskItem" data-checked={checked ? 'true' : 'false'}>
      <label contentEditable={false} suppressContentEditableWarning>
        <input
          type="checkbox"
          aria-label="完成"
          checked={checked}
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => {
            if (!editor.isEditable) return
            const next = e.target.checked
            const pos = getPos()
            if (typeof pos !== 'number') return
            editor
              .chain()
              .focus(undefined, { scrollIntoView: false })
              .command(({ tr }) => {
                const current = tr.doc.nodeAt(pos)
                if (!current) return false
                tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: next })
                return true
              })
              .run()
          }}
        />
      </label>
      <NodeViewContent as="div" className="task-content" />
    </NodeViewWrapper>
  )
}

export const TaskItem = BaseTaskItem.configure({ nested: true }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView)
  },
})
