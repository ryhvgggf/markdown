import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

interface ActiveEditor {
  noteId: string | null
  editor: Editor | null
  set(noteId: string, editor: Editor | null): void
}

/** The mounted note editor, so the right card can read headings and move the cursor. */
export const useActiveEditor = create<ActiveEditor>((set) => ({
  noteId: null,
  editor: null,
  set: (noteId, editor) =>
    set((s) => (editor ? { noteId, editor } : s.noteId === noteId ? { noteId: null, editor: null } : s)),
}))
