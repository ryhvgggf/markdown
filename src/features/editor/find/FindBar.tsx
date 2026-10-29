import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { IconButton } from '@/ui/components/IconButton'
import { ChevronDown, Close, Search } from '@/ui/icons'
import { TEXT_COLORS } from '../marks/formatting'
import { applyToAllMatches } from './apply-to-matches'
import { getFindState } from './find-extension'

/** Ctrl/Cmd+F find bar for the current note (bounded editor feature, no design doc — see chat history). */
export function FindBar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => (e ? getFindState(e) : null) })
  const [applyOpen, setApplyOpen] = useState(false)
  const [replaceText, setReplaceText] = useState('')
  const [color, setColor] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (s?.open) inputRef.current?.focus()
  }, [s?.open])

  if (!editor || !s?.open) return null

  const count = s.matches.length
  const close = () => {
    editor.commands.closeFind()
    editor.commands.focus()
  }
  const step = (dir: 'findPrev' | 'findNext') => () => editor.commands[dir]()

  return (
    <div role="search" aria-label="尋找" className="glass-float find-bar flex flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1">
        <Search size={14} className="shrink-0 text-fg-tertiary" />
        <input
          ref={inputRef}
          aria-label="尋找文字"
          value={s.query}
          onChange={(e) => editor.commands.setFindQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              step(e.shiftKey ? 'findPrev' : 'findNext')()
            }
          }}
          placeholder="尋找…"
          className="h-7 w-40 rounded-control bg-fill px-2 text-sm text-fg outline-none placeholder:text-fg-tertiary"
        />
        <span className="w-12 shrink-0 text-center text-xs text-fg-tertiary">{s.query ? `${count ? s.current + 1 : 0} / ${count}` : ''}</span>
        <IconButton label="上一個" tooltip disabled={!count} onClick={step('findPrev')}>
          <ChevronDown size={14} className="rotate-180" />
        </IconButton>
        <IconButton label="下一個" tooltip disabled={!count} onClick={step('findNext')}>
          <ChevronDown size={14} />
        </IconButton>
        <button
          type="button"
          aria-pressed={applyOpen}
          onClick={() => setApplyOpen((v) => !v)}
          className={`h-7 rounded-control px-2 text-sm text-fg-secondary hover:bg-fill hover:text-fg ${applyOpen ? 'bg-fill text-fg' : ''}`}
        >
          取代／格式
        </button>
        <IconButton label="關閉" tooltip onClick={close}>
          <Close size={14} />
        </IconButton>
      </div>
      {applyOpen && (
        <div className="flex items-center gap-1.5">
          <input
            aria-label="取代為"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="取代為（可留空）"
            className="h-7 w-40 rounded-control bg-fill px-2 text-sm text-fg outline-none placeholder:text-fg-tertiary"
          />
          <div className="flex gap-1" role="group" aria-label="文字顏色">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                aria-pressed={color === c.value}
                onClick={() => setColor((v) => (v === c.value ? undefined : c.value))}
                className={`size-5 rounded-full border border-black/10 ${color === c.value ? 'ring-2 ring-accent ring-offset-1' : ''}`}
                style={{ background: c.value }}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!count || (!replaceText && color === undefined)}
            onClick={() => {
              applyToAllMatches(editor, s.matches, { text: replaceText || undefined, color })
              setReplaceText('')
              setColor(undefined)
            }}
            className="h-7 rounded-control bg-accent px-2.5 text-sm text-white transition hover:opacity-90 disabled:opacity-40"
          >
            套用
          </button>
        </div>
      )}
    </div>
  )
}
