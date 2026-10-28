import { Fragment, forwardRef, useEffect, useImperativeHandle, useState, type ComponentType } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import {
  Bold, CheckSquare, CodeBlock, FileIcon, Heading1, Heading2, Heading3, Highlighter, ImageIcon, Italic, Lightbulb, ListBullet, ListOrdered, Minus, Quote, Strikethrough, TableIcon, TextT, Underline,
  type IconProps,
} from '@/ui/icons'
import { filterSlashItems, type SlashItem } from './slash-items'
import { suggestionPopup, type PopupListHandle } from './suggestion-popup'

const ICONS: Record<string, ComponentType<IconProps>> = {
  text: TextT, h1: Heading1, h2: Heading2, h3: Heading3, bullet: ListBullet, ordered: ListOrdered, task: CheckSquare,
  quote: Quote, callout: Lightbulb, code: CodeBlock, table: TableIcon, divider: Minus, media: ImageIcon, file: FileIcon,
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, highlight: Highlighter, 'inline-code': CodeBlock,
}

type ListProps = { items: SlashItem[]; command: (item: SlashItem) => void }

const SlashList = forwardRef<PopupListHandle, ListProps>(function SlashList({ items, command }, ref) {
  const [selected, setSelected] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    setSelected(0)
  }
  const pick = (i: number) => {
    const item = items[i]
    if (item && !item.disabled) command(item)
  }
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return true
        const d = e.key === 'ArrowDown' ? 1 : -1
        setSelected((s) => (s + d + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter') {
        if (!items.length) return false // nothing to pick: the popup closes (SuggestionKeys)
        pick(selected)
        return true
      }
      return false
    },
  }))
  useEffect(() => {
    document.querySelector('[data-slash-menu] [aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    <div data-slash-menu className="glass-float popup-pop max-h-80 w-[300px] overflow-y-auto p-1.5">
      {items.length === 0 ? (
        <div className="px-2 py-3 text-sm text-fg-secondary">沒有符合的區塊</div>
      ) : (
        <div role="listbox" aria-label="基本區塊">
          {items.map((item, i) => {
            const Icon = ICONS[item.id]
            const group = item.group ?? 'block'
            const first = i === 0 || (items[i - 1].group ?? 'block') !== group
            return (
              <Fragment key={item.id}>
                {first && <div role="presentation" className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-secondary">{group === 'format' ? '文字格式' : '基本區塊'}</div>}
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
                  {Icon && <Icon size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-base text-fg">{item.label}</span>
                  <span className="block truncate text-xs text-fg-secondary">{item.hint}</span>
                </span>
              </div>
              </Fragment>
            )
          })}
        </div>
      )}
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
        render: suggestionPopup<SlashItem, ListProps>(SlashList, (props) => ({ items: props.items, command: props.command })),
      }),
    ]
  },
})
