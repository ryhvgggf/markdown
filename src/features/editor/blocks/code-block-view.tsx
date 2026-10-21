import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { CODE_LANGUAGES } from './code-languages'

export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? ''
  return (
    <NodeViewWrapper className="code-block">
      <select
        className="code-lang"
        contentEditable={false}
        aria-label="程式語言"
        value={language}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ language: e.target.value || null })}
      >
        <option value="">純文字</option>
        {CODE_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <pre spellCheck={false}>
        <NodeViewContent as={'code' as 'div'} className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}
