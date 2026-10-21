import type { Editor } from '@tiptap/core'
import { Menu } from '@/ui/components/Menu'
import { ChevronDown } from '@/ui/icons'

type Entry = { label: string; run: (e: Editor) => boolean; active?: (e: Editor) => boolean }

const ENTRIES: Entry[] = [
  { label: '段落', run: (e) => e.chain().focus().clearNodes().run(), active: (e) => e.isActive('paragraph') },
  { label: '標題 1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { label: '標題 2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { label: '標題 3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { label: '項目清單', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { label: '編號清單', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { label: '待辦清單', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { label: '引用', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { label: '提示框', run: (e) => e.chain().focus().wrapIn('callout').run(), active: (e) => e.isActive('callout') },
  { label: '程式碼', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
]

export function ConvertMenu({ editor, onOpenChange }: { editor: Editor; onOpenChange: (open: boolean) => void }) {
  return (
    <Menu
      align="start"
      onOpenChange={onOpenChange}
      onCloseAutoFocus={(e) => e.preventDefault()}
      trigger={
        <button
          type="button"
          aria-label="轉為…"
          onMouseDown={(e) => e.preventDefault()}
          className="inline-flex h-7 items-center gap-1 rounded-control px-2 text-sm text-fg-secondary hover:bg-fill hover:text-fg"
        >
          轉為…
          <ChevronDown size={14} />
        </button>
      }
    >
      {ENTRIES.map((en) => (
        <Menu.Item key={en.label} onSelect={() => en.run(editor)} aria-checked={en.active?.(editor) ? true : undefined}>
          {en.label}
        </Menu.Item>
      ))}
    </Menu>
  )
}
