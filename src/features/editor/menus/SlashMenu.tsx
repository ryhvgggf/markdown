import { Fragment, forwardRef, useEffect, useImperativeHandle, useState, type ComponentType } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import {
  Bold, CheckSquare, CodeBlock, CodeInline, FileIcon, Heading1, Heading2, Heading3, Highlighter, ImageIcon, Italic, Lightbulb, Link, ListBullet,
  ListOrdered, Minus, Quote, Strikethrough, TableIcon, Tag, TextColor, TextT, Underline,
  type IconProps,
} from '@/ui/icons'
import { SLASH_GROUPS, filterSlashItems, itemsOfGroup, type SlashGroup, type SlashItem } from './slash-items'
import { suggestionPopup, type PopupListHandle } from './suggestion-popup'

const ICONS: Record<string, ComponentType<IconProps>> = {
  text: TextT, h1: Heading1, h2: Heading2, h3: Heading3, bullet: ListBullet, ordered: ListOrdered, task: CheckSquare,
  quote: Quote, callout: Lightbulb, code: CodeBlock, table: TableIcon, divider: Minus, media: ImageIcon, file: FileIcon,
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, highlight: Highlighter, 'inline-code': CodeInline,
  'clear-color': TextColor, 'note-link': Link, tag: Tag,
}

type ListProps = { items: SlashItem[]; query: string; command: (item: SlashItem) => void }

const groupLabel = (g: SlashGroup) => SLASH_GROUPS.find((x) => x.id === g)!.label

/**
 * No query: tabs (← → switch), one group at a time. With a query: every match from all tabs, grouped
 * (← → then move the caret in the query as usual).
 */
const SlashList = forwardRef<PopupListHandle, ListProps>(function SlashList({ items, query, command }, ref) {
  const [tab, setTab] = useState<SlashGroup>('block')
  const [selected, setSelected] = useState(0)
  const searching = query.trim() !== ''
  const shown = searching ? items : itemsOfGroup(tab)
  const [prevKey, setPrevKey] = useState('')
  const key = searching ? `q:${items.map((i) => i.id).join()}` : `t:${tab}`
  if (prevKey !== key) {
    setPrevKey(key)
    setSelected(0)
  }
  const pick = (i: number) => {
    const item = shown[i]
    if (item && !item.disabled) command(item)
  }
  const goTab = (d: number) => {
    const at = SLASH_GROUPS.findIndex((g) => g.id === tab)
    setTab(SLASH_GROUPS[(at + d + SLASH_GROUPS.length) % SLASH_GROUPS.length].id)
  }
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!shown.length) return true
        const d = e.key === 'ArrowDown' ? 1 : -1
        setSelected((s) => (s + d + shown.length) % shown.length)
        return true
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !searching && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        goTab(e.key === 'ArrowRight' ? 1 : -1)
        return true
      }
      if (e.key === 'Enter') {
        if (!shown.length) return false // nothing to pick: the popup closes (SuggestionKeys)
        pick(selected)
        return true
      }
      return false
    },
  }))
  useEffect(() => {
    document.querySelector('[data-slash-menu] [aria-selected="true"][role="option"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, key])

  return (
    <div data-slash-menu className="glass-float popup-pop max-h-80 w-[300px] overflow-y-auto p-1.5">
      {!searching && (
        <div role="tablist" aria-label="功能分頁" className="mb-1 flex gap-0.5 rounded-control bg-fill p-0.5">
          {SLASH_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === tab}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(g.id)}
              className={`flex-1 rounded-control px-1 py-1 text-xs ${g.id === tab ? 'bg-surface font-medium text-fg shadow-sm' : 'text-fg-secondary hover:text-fg'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="px-2 py-3 text-sm text-fg-secondary">沒有符合的功能</div>
      ) : (
        <div role="listbox" aria-label={searching ? '搜尋結果' : groupLabel(tab)}>
          {shown.map((item, i) => {
            const Icon = ICONS[item.id]
            const group = item.group ?? 'block'
            const first = searching && (i === 0 || (shown[i - 1].group ?? 'block') !== group)
            return (
              <Fragment key={item.id}>
                {first && <div role="presentation" className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-secondary">{groupLabel(group)}</div>}
                <div
                  role="option"
                  aria-selected={i === selected}
                  aria-disabled={item.disabled || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => pick(i)}
                  className={`flex items-center gap-2.5 rounded-control px-1.5 py-1 ${
                    i === selected ? 'bg-accent/10' : ''
                  } ${item.disabled ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-control bg-fill text-fg-secondary">
                    {item.swatch ? (
                      <span className="size-4 rounded-full border border-black/10" style={{ background: item.swatch }} />
                    ) : (
                      Icon && <Icon size={16} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base text-fg">{item.label}</span>
                    {item.hint && <span className="block truncate text-xs text-fg-secondary">{item.hint}</span>}
                  </span>
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
      {!searching && <div className="px-2 pb-0.5 pt-1.5 text-xs text-fg-secondary">← → 切換分頁</div>}
    </div>
  )
})

function runItem(editor: Editor, range: Range, item: SlashItem) {
  editor.chain().focus().deleteRange(range).run()
  item.run(editor)
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        allowedPrefixes: null, // anywhere in a line, also right after Chinese text
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return false
          const before = state.doc.textBetween($from.start(), range.from, '\n', '\0')
          if (!before) return true
          // Mid-line: not inside a URL / path / "and/or", and only while something matches (so "是/否" stays quiet).
          if (/[A-Za-z0-9:/.\-_]$/.test(before)) return false
          const query = state.doc.textBetween(range.from + 1, range.to, '\n', '\0')
          return !query || filterSlashItems(query).length > 0
        },
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => runItem(editor, range, props),
        render: suggestionPopup<SlashItem, ListProps>(SlashList, (props) => ({ items: props.items, query: props.query, command: props.command })),
      }),
    ]
  },
})
