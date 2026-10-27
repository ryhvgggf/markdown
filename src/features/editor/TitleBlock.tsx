import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { VaultError } from '@/core/vault/types'
import { focusEditorStart, registerTitle } from './focus-bridge'
import { clearTitleDraft, saveTitleDraft } from './title-drafts'
import { isComposingEvent } from './ime'
import { isTypingKey, markTyping } from './typing'

/** Typing pauses this long before the title is saved (also saved on blur, Enter, pagehide and unmount). */
export const TITLE_COMMIT_DELAY_MS = 500

export function TitleBlock({ noteId }: { noteId: string }) {
  const { vault } = useServices()
  const [value, setValue] = useState(() => vault.getNote(noteId)?.title ?? '')
  const ref = useRef<HTMLInputElement>(null)
  // Refs, so timers / pagehide / unmount see the latest state.
  const latest = useRef(value)
  /** The user edited the field since the last commit (only then do we write, so a stale value never overwrites another tab's rename). */
  const dirty = useRef(false)
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Stored title when the current edit started (for the reload-safe draft). */
  const base = useRef('')

  const commit = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current || composing.current) return // never commit mid-composition
    const current = vault.getNote(noteId)
    if (!current) return
    const v = latest.current
    if (v.trim() !== '' && !vault.isTitleAvailable(v, noteId)) return // colliding draft stays, with its hint
    dirty.current = false
    if (v.trim() !== current.title) {
      try {
        vault.renameNote(noteId, v)
      } catch (e) {
        if (!(e instanceof VaultError)) throw e
        dirty.current = true
        return
      }
    }
    // Once the vault has stored it, the reload-safe draft is no longer needed.
    void vault.flushWrites().then(() => {
      if (!vault.hasPendingWrites()) clearTitleDraft(noteId, v)
    })
  }, [vault, noteId])

  const schedule = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(commit, TITLE_COMMIT_DELAY_MS)
  }

  useEffect(() => {
    const sync = () => {
      if (dirty.current || composing.current) return // the user's draft wins until it is committed
      const t = vault.getNote(noteId)?.title ?? ''
      if (latest.current.trim() === t) return // e.g. our own commit of "hello " → keep the trailing space
      latest.current = t
      setValue(t)
    }
    return vault.observe(sync)
  }, [vault, noteId])

  useEffect(() => {
    window.addEventListener('pagehide', commit)
    return () => {
      window.removeEventListener('pagehide', commit)
      commit() // switching notes unmounts the title: save what was typed
    }
  }, [commit])

  useEffect(() => {
    registerTitle(noteId, ref.current)
    return () => registerTitle(noteId, null)
  }, [noteId])

  const collides = value.trim() !== '' && !vault.isTitleAvailable(value, noteId)

  return (
    <div className="px-6 pt-12">
      <div className="mx-auto" style={{ maxWidth: 'var(--editor-width, 680px)' }}>
      <input
        ref={ref}
        type="text"
        aria-label="筆記標題"
        placeholder="未命名"
        value={value}
        onChange={(e) => {
          if (!dirty.current) base.current = vault.getNote(noteId)?.title ?? ''
          latest.current = e.target.value
          dirty.current = true
          if (!composing.current) saveTitleDraft(noteId, e.target.value, base.current)
          setValue(e.target.value)
          if (!composing.current) schedule()
        }}
        onCompositionStart={() => {
          composing.current = true
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = null
        }}
        onCompositionEnd={(e) => {
          composing.current = false
          if (!dirty.current) base.current = vault.getNote(noteId)?.title ?? ''
          latest.current = e.currentTarget.value
          dirty.current = true
          saveTitleDraft(noteId, e.currentTarget.value, base.current)
          schedule()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (isTypingKey(e.nativeEvent)) markTyping() // observes only, composition included
          if (isComposingEvent(e.nativeEvent)) return
          // ArrowDown (like Enter) moves to the start of the first body block; it never creates a block.
          const down = e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
          if (e.key !== 'Enter' && !down) return
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
