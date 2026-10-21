import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { IconButton } from '@/ui/components/IconButton'
import { Bold, CodeInline, Italic, Link as LinkIcon, Strikethrough, Underline } from '@/ui/icons'
import { isSafeUrl } from '../marks/formatting'
import { HighlightMenu, TextColorMenu } from './ColorMenus'
import { ConvertMenu } from './ConvertMenu'

function Toggle({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <IconButton
      label={label}
      tooltip
      aria-pressed={active}
      className={active ? 'bg-fill text-fg' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
  )
}

function normalizeUrl(raw: string): string {
  const v = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : `https://${v}`
}

function LinkInput({ editor, initial, onClose }: { editor: Editor; initial: string; onClose: () => void }) {
  const [value, setValue] = useState(initial)
  const [invalid, setInvalid] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const finish = () => {
    onClose()
    editor.commands.focus()
  }
  return (
    <input
      ref={ref}
      aria-label="連結網址"
      aria-invalid={invalid}
      placeholder="貼上網址，Enter 套用"
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Escape') {
          e.preventDefault()
          finish()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (!value.trim()) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return onClose()
          }
          const href = normalizeUrl(value)
          if (!isSafeUrl(href)) return setInvalid(true)
          editor.chain().focus().setLink({ href }).run()
          onClose()
        }
      }}
      className={`h-7 w-56 rounded-control bg-fill px-2 text-sm text-fg outline-none placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-accent ${invalid ? 'ring-2 ring-[#C62828]' : ''}`}
    />
  )
}

export function FormatToolbar({ editor }: { editor: Editor | null }) {
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const menusOpen = useRef(0)
  const linkRef = useRef(false)

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        href: (e.getAttributes('link').href as string | undefined) ?? '',
        color: (e.getAttributes('textStyle').color as string | undefined) ?? '',
        highlight: (e.getAttributes('highlight').color as string | undefined) ?? '',
        from: e.state.selection.from,
        to: e.state.selection.to,
      },
  })

  const range = s ? `${s.from}-${s.to}` : ''
  const linkOpen = linkFor !== null && linkFor === range
  useEffect(() => {
    linkRef.current = linkOpen
  }, [linkOpen])

  if (!editor || !s) return null
  const track = (open: boolean) => {
    menusOpen.current = Math.max(0, menusOpen.current + (open ? 1 : -1))
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatToolbar"
      updateDelay={60}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: ed, view, state }) => {
        const sel = state.selection
        if (sel.empty || !(sel instanceof TextSelection) || !ed.isEditable) return false
        if (ed.isActive('codeBlock') || !state.doc.textBetween(sel.from, sel.to).length) return false
        const root = view.dom.parentElement?.parentElement
        return view.hasFocus() || menusOpen.current > 0 || linkRef.current || Boolean(root?.contains(document.activeElement))
      }}
    >
      <div role="toolbar" aria-label="文字格式" className="glass-float flex items-center gap-0.5 p-1">
        {linkOpen ? (
          <LinkInput editor={editor} initial={s.href} onClose={() => setLinkFor(null)} />
        ) : (
          <>
            <Toggle label="粗體" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold size={16} />
            </Toggle>
            <Toggle label="斜體" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic size={16} />
            </Toggle>
            <Toggle label="底線" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <Underline size={16} />
            </Toggle>
            <Toggle label="刪除線" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Strikethrough size={16} />
            </Toggle>
            <Toggle label="行內程式碼" active={s.code} onClick={() => editor.chain().focus().toggleCode().run()}>
              <CodeInline size={16} />
            </Toggle>
            <Toggle label="連結" active={s.link} onClick={() => setLinkFor(range)}>
              <LinkIcon size={16} />
            </Toggle>
            <span className="mx-1 h-4 w-px bg-fill" aria-hidden="true" />
            <TextColorMenu editor={editor} active={Boolean(s.color)} current={s.color} onOpenChange={track} />
            <HighlightMenu editor={editor} active={Boolean(s.highlight)} current={s.highlight} onOpenChange={track} />
            <span className="mx-1 h-4 w-px bg-fill" aria-hidden="true" />
            <ConvertMenu editor={editor} onOpenChange={track} />
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
