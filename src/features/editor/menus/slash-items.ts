import type { Editor } from '@tiptap/core'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../marks/formatting'

export type SlashItem = {
  id: string
  label: string
  hint: string
  aliases: string[]
  /** Tab it lives in (blocks by default). Format and colour items switch a style on for the text typed next. */
  group?: SlashGroup
  /** A colour dot shown instead of an icon. */
  swatch?: string
  /** Not selectable yet (wired by a later task). */
  disabled?: boolean
  run(editor: Editor): void
}

export type SlashGroup = 'block' | 'format' | 'color' | 'insert'
export const SLASH_GROUPS: { id: SlashGroup; label: string }[] = [
  { id: 'block', label: '區塊' },
  { id: 'format', label: '文字格式' },
  { id: 'color', label: '顏色' },
  { id: 'insert', label: '插入' },
]

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
  { id: 'bold', group: 'format', label: '粗體', hint: '', aliases: ['bold', 'cuti'], run: (e) => void chain(e).toggleBold().run() },
  { id: 'italic', group: 'format', label: '斜體', hint: '', aliases: ['italic', 'xieti'], run: (e) => void chain(e).toggleItalic().run() },
  { id: 'underline', group: 'format', label: '底線', hint: '', aliases: ['underline', 'dixian'], run: (e) => void chain(e).toggleUnderline().run() },
  { id: 'strike', group: 'format', label: '刪除線', hint: '', aliases: ['strike', 'del', 'shanchu'], run: (e) => void chain(e).toggleStrike().run() },
  { id: 'highlight', group: 'format', label: '螢光', hint: '', aliases: ['highlight', 'mark', 'hl', 'yingguang'], run: (e) => void chain(e).toggleHighlight({ color: '#FFF1A8' }).run() },
  { id: 'inline-code', group: 'format', label: '行內程式碼', hint: '', aliases: ['code', 'inline', 'mono'], run: (e) => void chain(e).toggleCode().run() },
  ...TEXT_COLORS.map((c): SlashItem => ({
    id: `color-${c.value}`, group: 'color', swatch: c.value, label: `文字顏色・${c.name}`, hint: '',
    aliases: ['color', 'yanse', 'wenzi'], run: (e) => void chain(e).setColor(c.value).run(),
  })),
  ...HIGHLIGHT_COLORS.slice(1).map((c): SlashItem => ({
    id: `hl-${c.value}`, group: 'color', swatch: c.value, label: `螢光・${c.name}`, hint: '',
    aliases: ['highlight', 'mark', 'hl', 'yingguang', 'yanse'], run: (e) => void chain(e).setHighlight({ color: c.value }).run(),
  })),
  { id: 'clear-color', group: 'color', label: '清除顏色', hint: '', aliases: ['clear', 'reset', 'default', 'qingchu'], run: (e) => void chain(e).unsetColor().unsetHighlight().run() },
  { id: 'media', group: 'insert', label: '圖片或影片', hint: '上傳或拖入圖片、影片', aliases: ['image', 'video', 'media', 'tu', 'pic'], run: (e) => void e.commands.pickMedia() },
  { id: 'file', group: 'insert', label: '檔案', hint: '上傳任意檔案，提供下載', aliases: ['file', 'pdf', 'attach', 'dangan'], run: (e) => void e.commands.pickFile() },
  { id: 'note-link', group: 'insert', label: '連結筆記', hint: '連到另一篇筆記', aliases: ['link', 'note', 'wiki', 'lianjie'], run: (e) => void chain(e).insertContent('[[').run() },
  { id: 'tag', group: 'insert', label: '標籤', hint: '輸入 # 與名稱，空白鍵完成', aliases: ['tag', 'hashtag', 'biaoqian'], run: (e) => void chain(e).insertContent('#').run() },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q)))
}

export const itemsOfGroup = (group: SlashGroup): SlashItem[] => SLASH_ITEMS.filter((i) => (i.group ?? 'block') === group)
