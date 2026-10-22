import type { Vault } from '@/core/vault/vault'

/**
 * Synchronous safety net for title edits: IndexedDB writes started from `pagehide` may not finish before a
 * reload/close, so the latest typed title is also kept in localStorage (synchronous) until the next start
 * confirms it was stored. A draft is applied at startup only if nobody renamed the note meanwhile.
 */
const PREFIX = 'notes-v2.titleDraft:'

interface Draft {
  /** What the user typed. */
  v: string
  /** The stored title when the user started editing. */
  base: string
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function saveTitleDraft(noteId: string, value: string, base: string): void {
  try {
    store()?.setItem(PREFIX + noteId, JSON.stringify({ v: value, base } satisfies Draft))
  } catch {
    /* storage full or blocked: the IndexedDB commit is still attempted */
  }
}

/** Forgets the draft once `value` is known to be stored (no-op when a newer draft replaced it). */
export function clearTitleDraft(noteId: string, value: string): void {
  try {
    const ls = store()
    const raw = ls?.getItem(PREFIX + noteId)
    if (!ls || raw == null) return
    const d = JSON.parse(raw) as Draft | null
    if (d?.v === value) ls.removeItem(PREFIX + noteId)
  } catch {
    /* best-effort */
  }
}

/** Applies drafts whose commit was lost (stored title still equals the draft's base); drops the rest. */
export function applyTitleDrafts(vault: Vault): void {
  const ls = store()
  if (!ls) return
  try {
    const keys: string[] = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (k?.startsWith(PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const noteId = k.slice(PREFIX.length)
      let d: Draft | null = null
      try {
        d = JSON.parse(ls.getItem(k) ?? 'null') as Draft | null
      } catch {
        /* malformed */
      }
      ls.removeItem(k)
      const note = vault.getNote(noteId)
      if (!note || !d || typeof d.v !== 'string') continue
      const v = d.v.trim()
      if (note.title === v || note.title !== d.base) continue // stored already, or renamed elsewhere since
      if (vault.isTitleAvailable(v, noteId)) vault.renameNote(noteId, v)
    }
  } catch {
    /* best-effort */
  }
}
