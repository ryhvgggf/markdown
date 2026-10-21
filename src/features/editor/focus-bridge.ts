import type { Editor } from '@tiptap/core'

// Lets the title input and the editor hand focus to each other without prop drilling.
const editors = new Map<string, Editor>()
const titles = new Map<string, HTMLInputElement>()

export const registerEditor = (noteId: string, e: Editor | null) =>
  void (e ? editors.set(noteId, e) : editors.delete(noteId))
export const registerTitle = (noteId: string, el: HTMLInputElement | null) =>
  void (el ? titles.set(noteId, el) : titles.delete(noteId))

export const focusEditorStart = (noteId: string) => editors.get(noteId)?.commands.focus('start')

export function focusTitleEnd(noteId: string): void {
  const el = titles.get(noteId)
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}
