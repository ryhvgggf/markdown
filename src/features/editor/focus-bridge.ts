import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'

// Lets the title input and the editor hand focus to each other without prop drilling.
const editors = new Map<string, Editor>()
const titles = new Map<string, HTMLInputElement>()

/** Focus requests made before the note's editor mounted (Enter in a fresh title), honoured for a short while. */
const pendingStart = new Map<string, number>()
const PENDING_FOCUS_MS = 3000

/**
 * Caret to the start of the body, focused NOW. Tiptap's `focus()` command re-focuses the editor in a later
 * animation frame; if the user has moved on (↑ back into the title) by then, that frame pulled the caret
 * back into the body (the WebKit keyboard-nav flake).
 */
function focusStart(e: Editor) {
  if (e.isDestroyed) return
  const { state, view } = e
  view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView())
  view.focus()
}

export const registerEditor = (noteId: string, e: Editor | null) => {
  if (!e) return void editors.delete(noteId)
  editors.set(noteId, e)
  const at = pendingStart.get(noteId)
  pendingStart.delete(noteId)
  if (at !== undefined && Date.now() - at < PENDING_FOCUS_MS) focusStart(e)
}
export const registerTitle = (noteId: string, el: HTMLInputElement | null) =>
  void (el ? titles.set(noteId, el) : titles.delete(noteId))

export const focusEditorStart = (noteId: string) => {
  const e = editors.get(noteId)
  if (e) return focusStart(e)
  pendingStart.set(noteId, Date.now()) // the editor is still loading: focus it once it registers
}

/** Returns false while the note's title input is not mounted (yet). */
export function focusTitleEnd(noteId: string): boolean {
  const el = titles.get(noteId)
  if (!el) return false
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
  return true
}
