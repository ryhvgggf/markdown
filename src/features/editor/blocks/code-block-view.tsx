import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Menu } from '@/ui/components/Menu'
import { ChevronDown } from '@/ui/icons'
import { CODE_LANGUAGES } from './code-languages'

export function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? ''
  const current = CODE_LANGUAGES.find((l) => l.value === language)?.label ?? '純文字'

  function choose(value: string) {
    updateAttributes({ language: value || null })
    // Return focus to the code so following keystrokes are not type-ahead on the menu.
    const pos = getPos()
    if (typeof pos !== 'number') return
    const end = pos + editor.state.doc.nodeAt(pos)!.nodeSize - 1
    editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(end).run()
  }

  return (
    <NodeViewWrapper className="code-block">
      <Menu
        align="end"
        onCloseAutoFocus={(e) => e.preventDefault()}
        trigger={
          <button
            type="button"
            className="code-lang"
            contentEditable={false}
            aria-label="程式語言"
            disabled={!editor.isEditable}
            onMouseDown={(e) => e.preventDefault()}
          >
            {current}
            <ChevronDown size={12} />
          </button>
        }
      >
        <Menu.Item onSelect={() => choose('')} aria-checked={language === '' ? true : undefined}>
          純文字
        </Menu.Item>
        {CODE_LANGUAGES.map((l) => (
          <Menu.Item key={l.value} onSelect={() => choose(l.value)} aria-checked={language === l.value ? true : undefined}>
            {l.label}
          </Menu.Item>
        ))}
      </Menu>
      <pre spellCheck={false}>
        <NodeViewContent as={'code' as 'div'} className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}
