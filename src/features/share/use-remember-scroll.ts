import { useEffect } from 'react'

/** Where the page was: the block at the top of the screen and how far below the top edge it sat. */
type Position = { id: string; offset: number }

const parse = (raw: string | null): Position | null => {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Position>) : null
    return v && typeof v.id === 'string' && v.id && typeof v.offset === 'number' && Number.isFinite(v.offset) ? { id: v.id, offset: v.offset } : null
  } catch {
    return null
  }
}

const blocks = () => document.querySelectorAll<HTMLElement>('.note-editor [data-block-id]')
const byId = (id: string) => [...blocks()].find((el) => el.dataset.blockId === id) ?? null

/** How long, after a reload, the saved place is re-applied (images and fonts loading move the page). */
const SETTLE_MS = 1500
const GIVE_UP_MS = 3000
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Share page: a reload (or a copy of the tab) stays where the reader was. The place is the block at the top of the
 * screen plus its offset, kept in this tab's `sessionStorage` under `key` — never in the address, so a copied
 * address does not carry it, and closing the tab forgets it. With `restore` false (the reader just switched notes or
 * followed a link) nothing is restored but the place is still kept. A block that no longer exists (an updated
 * snapshot) leaves the page at the top.
 */
export function useRememberScroll(key: string | null, restore: boolean): void {
  useEffect(() => {
    if (!key) return
    let saved: Position | null = null
    try {
      saved = restore ? parse(sessionStorage.getItem(key)) : null
    } catch {
      saved = null
    }
    let live = true
    let ready = saved === null // saving starts once the saved place has been put back
    let touched = false
    const cancel = () => {
      touched = true
      ready = true
    }
    for (const e of USER_EVENTS) window.addEventListener(e, cancel, { passive: true })

    const apply = () => {
      const el = saved && byId(saved.id)
      if (!el || !saved) return false
      const dy = el.getBoundingClientRect().top - saved.offset
      if (Math.abs(dy) > 1) window.scrollBy(0, dy)
      return true
    }
    const started = Date.now()
    let frame = 0
    const settle = () => {
      frame = 0
      if (!live || touched || !saved) return
      const age = Date.now() - started
      const found = apply()
      if (found) ready = true
      if (age < (found ? SETTLE_MS : GIVE_UP_MS)) frame = requestAnimationFrame(settle)
      else ready = true
    }
    if (saved) frame = requestAnimationFrame(settle)

    let pending = 0
    const save = () => {
      pending = 0
      if (!live || !ready) return
      try {
        if (window.scrollY < 2) return sessionStorage.removeItem(key)
        const top = [...blocks()].find((el) => el.getBoundingClientRect().bottom > 1)
        if (top?.dataset.blockId) sessionStorage.setItem(key, JSON.stringify({ id: top.dataset.blockId, offset: top.getBoundingClientRect().top }))
      } catch {
        /* storage unavailable: nothing is remembered */
      }
    }
    const onScroll = () => {
      if (!pending) pending = requestAnimationFrame(save)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      live = false
      window.removeEventListener('scroll', onScroll)
      for (const e of USER_EVENTS) window.removeEventListener(e, cancel)
      if (frame) cancelAnimationFrame(frame)
      if (pending) cancelAnimationFrame(pending)
    }
  }, [key, restore])
}
