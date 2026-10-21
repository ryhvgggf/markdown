import type { EditorView } from '@tiptap/pm/view'

/** True while an IME composition is in progress (Enter etc. must not trigger commands). */
export function isComposingEvent(e: KeyboardEvent, view?: EditorView): boolean {
  return e.isComposing || e.keyCode === 229 || view?.composing === true
}
