import type { Editor } from '@tiptap/core'

export type SlashItem = {
  id: string
  label: string
  hint: string
  aliases: string[]
  /** Not selectable yet (wired by a later task). */
  disabled?: boolean
  run(editor: Editor): void
}

const chain = (e: Editor) => e.chain().focus()

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: '文字', hint: '從一般段落開始', aliases: ['text', 'p'], run: (e) => void chain(e).setParagraph().run() },
  { id: 'h1', label: '標題 1', hint: '大標題', aliases: ['h1', 'heading', 'title', 'bt'], run: (e) => void chain(e).toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: '標題 2', hint: '中標題', aliases: ['h2', 'heading'], run: (e) => void chain(e).toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: '標題 3', hint: '小標題', aliases: ['h3', 'heading'], run: (e) => void chain(e).toggleHeading({ level: 3 }).run() },
  { id: 'bullet', label: '項目清單', hint: '建立簡單的項目符號清單', aliases: ['ul', 'bullet', 'list'], run: (e) => void chain(e).toggleBulletList().run() },
  { id: 'ordered', label: '編號清單', hint: '建立有順序的清單', aliases: ['ol', 'number'], run: (e) => void chain(e).toggleOrderedList().run() },
  { id: 'task', label: '待辦清單', hint: '用核取方塊追蹤事項', aliases: ['todo', 'task', 'checkbox'], run: (e) => void chain(e).toggleTaskList().run() },
  { id: 'quote', label: '引用', hint: '引述一段文字', aliases: ['quote'], run: (e) => void chain(e).toggleBlockquote().run() },
  { id: 'callout', label: '提示框', hint: '醒目標示重要資訊', aliases: ['callout', 'note'], run: (e) => void chain(e).insertCallout().run() },
  { id: 'code', label: '程式碼', hint: '含語法高亮的程式碼區塊', aliases: ['code'], run: (e) => void chain(e).toggleCodeBlock().run() },
  { id: 'table', label: '表格', hint: '插入 3 × 3 表格', aliases: ['table'], run: (e) => void chain(e).insertTable().run() },
  { id: 'divider', label: '分隔線', hint: '以水平線分隔內容', aliases: ['hr', 'divider'], run: (e) => void chain(e).setHorizontalRule().run() },
  { id: 'media', label: '圖片或影片', hint: '即將推出', aliases: ['image', 'video', 'media'], disabled: true, run: () => {} },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q)))
}
