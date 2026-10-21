import { useEffect, useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { focusEditorStart, registerTitle } from './focus-bridge'
import { isComposingEvent } from './ime'

export function TitleBlock({ noteId }: { noteId: string }) {
  const { vault } = useServices()
  const [value, setValue] = useState(() => vault.getNote(noteId)?.title ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const sync = () => {
      if (document.activeElement === ref.current) return
      setValue(vault.getNote(noteId)?.title ?? '')
    }
    return vault.observe(sync)
  }, [vault, noteId])

  useEffect(() => {
    registerTitle(noteId, ref.current)
    return () => registerTitle(noteId, null)
  }, [noteId])

  const collides = value.trim() !== '' && !vault.isTitleAvailable(value, noteId)

  const commit = () => {
    const current = vault.getNote(noteId)
    if (!current || collides) return
    if (value.trim() !== current.title) vault.renameNote(noteId, value)
  }

  return (
    <div className="px-6 pt-12">
      <div className="mx-auto" style={{ maxWidth: 'var(--editor-width, 680px)' }}>
      <input
        ref={ref}
        type="text"
        aria-label="筆記標題"
        placeholder="未命名"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || isComposingEvent(e.nativeEvent)) return
          e.preventDefault()
          commit()
          if (!collides) focusEditorStart(noteId)
        }}
        className="block w-full bg-transparent p-0 font-semibold text-fg outline-none placeholder:text-fg-tertiary"
        style={{ fontSize: 'var(--text-display)', letterSpacing: '-0.022em', lineHeight: 1.25 }}
      />
      {collides && (
        <p role="status" className="mt-1 text-xs text-fg-secondary">
          已有同名筆記
        </p>
      )}
      </div>
    </div>
  )
}
