import { forwardRef, useEffect, useImperativeHandle, useState, type ComponentType } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import {
  CheckSquare, CodeBlock, Heading1, Heading2, Heading3, ImageIcon, Lightbulb, ListBullet, ListOrdered, Minus, Quote, TableIcon, TextT,
  type IconProps,
} from '@/ui/icons'
import { isComposingEvent } from '../ime'
import { filterSlashItems, type SlashItem } from './slash-items'

const ICONS: Record<string, ComponentType<IconProps>> = {
  text: TextT, h1: Heading1, h2: Heading2, h3: Heading3, bullet: ListBullet, ordered: ListOrdered, task: CheckSquare,
  quote: Quote, callout: Lightbulb, code: CodeBlock, table: TableIcon, divider: Minus, media: ImageIcon,
}

type ListProps = { items: SlashItem[]; command: (item: SlashItem) => void }
type ListHandle = { onKeyDown(e: KeyboardEvent): boolean }

const SlashList = forwardRef<ListHandle, ListProps>(function SlashList({ items, command }, ref) {
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
        if (items.length) pick(selected)
        return true
      }
      return false
    },
  }))
  useEffect(() => {
    document.querySelector('[data-slash-menu] [aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    <div data-slash-menu className="glass-float max-h-80 w-[300px] overflow-y-auto p-1.5">
      <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-tertiary">基本區塊</div>
      {items.length === 0 ? (
        <div className="px-2 py-3 text-sm text-fg-tertiary">沒有符合的區塊</div>
      ) : (
        <div role="listbox" aria-label="基本區塊">
          {items.map((item, i) => {
            const Icon = ICONS[item.id]
            return (
              <div
                key={item.id}
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
                  <span className="block truncate text-xs text-fg-tertiary">{item.hint}</span>
                </span>
              </div>
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

function place(el: HTMLElement, props: SuggestionProps<SlashItem>) {
  const rect = props.clientRect?.()
  if (!rect) return
  void computePosition(
    { getBoundingClientRect: () => rect },
    el,
    { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(6), flip(), shift({ padding: 8 })] },
  ).then(({ x, y }) => {
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: true,
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => runItem(editor, range, props),
        render: () => {
          let renderer: ReactRenderer<ListHandle, ListProps> | null = null
          const mount = (props: SuggestionProps<SlashItem, SlashItem>) => {
            const p = { items: props.items, command: props.command }
            if (renderer) renderer.updateProps(p)
            else {
              renderer = new ReactRenderer(SlashList, { props: p, editor: props.editor })
              const el = renderer.element as HTMLElement
              el.style.position = 'fixed'
              el.style.zIndex = '60'
              el.style.left = '0'
              el.style.top = '0'
              document.body.appendChild(el)
            }
            place(renderer.element as HTMLElement, props)
          }
          return {
            onStart: mount,
            onUpdate: mount,
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (isComposingEvent(event, view)) return false
              return renderer?.ref?.onKeyDown(event) ?? false
            },
            onExit: () => {
              renderer?.element.remove()
              renderer?.destroy()
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
