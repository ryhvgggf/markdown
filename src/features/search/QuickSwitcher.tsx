import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { isComposingEvent } from '@/features/editor/ime'
import { isMac } from '@/features/rail/use-rail'
import { Dialog } from '@/ui/components/Dialog'
import { Search } from '@/ui/icons'
import { useSwitcherRows, type Row } from './use-switcher-rows'

function Bold({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold">{text.slice(at, at + needle.length)}</strong>
      {text.slice(at + needle.length)}
    </>
  )
}

export function QuickSwitcher() {
  const open = useUi((s) => s.quickSwitcherOpen)
  const setOpen = useUi((s) => s.setQuickSwitcher)

  const returnTo = useRef<Element | null>(null)
  // Runs before Radix moves focus into the dialog, so we remember where it was.
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement
  }, [open])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return
      if (!(isMac() ? e.metaKey : e.ctrlKey)) return
      if (e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      useUi.getState().setQuickSwitcher(!useUi.getState().quickSwitcherOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Dialog
      title="快速切換"
      palette
      open={open}
      onOpenChange={(v) => setOpen(v)}
      onCloseAutoFocus={(e) => {
        const el = returnTo.current
        if (el instanceof HTMLElement && el !== document.body && el.isConnected) {
          e.preventDefault()
          el.focus()
        }
      }}
    >
      <Panel />
    </Dialog>
  )
}

function Panel() {
  const { vault } = useServices()
  const [query, setQuery] = useState(() => useUi.getState().quickSwitcherSeed)
  const [active, setActive] = useState(0)
  const { rows, settled, failed } = useSwitcherRows(query)
  const index = Math.min(active, Math.max(rows.length - 1, 0))

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return
      const ui = useUi.getState()
      if (row.kind === 'create') {
        const made = vault.createNote({ title: row.title })
        ui.setQuickSwitcher(false)
        ui.openNote(made.id)
      } else {
        ui.setQuickSwitcher(false)
        ui.openNote(row.noteId)
      }
    },
    [vault],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
    if (isComposingEvent(e.nativeEvent)) return
    e.preventDefault()
    if (e.key === 'Enter') {
      const row = rows[index]
      // A stale hit list (query changed, results pending) must not open the wrong note.
      if (row && (row.kind === 'create' || settled || !query.trim())) choose(row)
      return
    }
    const n = rows.length
    if (n) setActive((index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
  }

  const notes = rows.filter((r) => r.kind === 'note')
  const create = rows.find((r) => r.kind === 'create')
  const option = (row: Row) => {
    const i = rows.indexOf(row)
    const on = i === index
    return (
      <div
        key={row.key}
        id={`qs-opt-${i}`}
        role="option"
        aria-selected={on}
        onMouseMove={() => setActive(i)}
        onClick={() => choose(row)}
        className={`flex cursor-pointer items-baseline gap-3 rounded-[8px] px-3 py-2 text-sm ${on ? 'bg-accent/12' : ''}`}
      >
        {row.kind === 'create' ? (
          <span>新增筆記「{row.title}」</span>
        ) : (
          <>
            <span className="shrink-0 text-fg">{row.match ? <Bold text={row.title} term={query.replace(/^\s*#/, '')} /> : row.title}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-secondary">{row.right}</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3">
        <Search size={20} className="shrink-0 text-fg-tertiary" />
        <input
          role="combobox"
          aria-label="搜尋筆記"
          aria-expanded="true"
          aria-controls="qs-list"
          aria-activedescendant={rows.length ? `qs-opt-${index}` : undefined}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="搜尋或建立筆記…"
          className="min-w-0 flex-1 bg-transparent text-lg text-fg outline-none placeholder:text-fg-tertiary"
        />
        <kbd className="rounded border border-black/10 px-1.5 py-0.5 text-xs text-fg-secondary">Esc</kbd>
      </div>
      <div id="qs-list" role="listbox" aria-label="搜尋結果" className="max-h-[380px] overflow-y-auto p-2">
        {notes.length > 0 && (
          <div role="group" aria-labelledby="qs-group">
            <div id="qs-group" className="px-3 pt-1 pb-1 text-xs text-fg-secondary">
              筆記
            </div>
            {notes.map(option)}
          </div>
        )}
        {create && option(create)}
      </div>
      {failed && (
        <p role="alert" className="px-4 pb-3 text-sm text-red-900">
          搜尋暫時無法使用，請重新整理頁面。
        </p>
      )}
    </div>
  )
}
