import type { Editor } from '@tiptap/core'

// Lets the title input and the editor hand focus to each other without prop drilling.
const editors = new Map<string, Editor>()
const titles = new Map<string, HTMLInputElement>()

/** Focus requests made before the note's editor mounted (Enter in a fresh title), honoured for a short while. */
const pendingStart = new Map<string, number>()
const PENDING_FOCUS_MS = 3000

export const registerEditor = (noteId: string, e: Editor | null) => {
  if (!e) return void editors.delete(noteId)
  editors.set(noteId, e)
  const at = pendingStart.get(noteId)
  pendingStart.delete(noteId)
  if (at !== undefined && Date.now() - at < PENDING_FOCUS_MS) e.commands.focus('start')
}
export const registerTitle = (noteId: string, el: HTMLInputElement | null) =>
  void (el ? titles.set(noteId, el) : titles.delete(noteId))

export const focusEditorStart = (noteId: string) => {
  const e = editors.get(noteId)
  if (e) return e.commands.focus('start')
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
