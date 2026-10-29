import { useEffect } from 'react'
import { useUi } from '@/app/ui-store'
import type { Vault } from '@/core/vault/vault'
import { isMac } from '@/features/rail/use-rail'

/**
 * App-wide Ctrl/⌘+Z. The note editor's own Yjs undo (from `Collaboration`) handles content edits and calls
 * `preventDefault()` when it does; whenever that doesn't happen — nothing focused in an editor, or that
 * note's own history is empty — this falls back to undoing the last sidebar action (create/rename/move/
 * trash/restore a note or folder; see `Vault.asUserAction`). A plain text input with actual content (e.g.
 * mid-rename) is left to the browser's native field undo — but an EMPTY one (e.g. a just-created note's
 * still-blank title) has nothing for that native undo to do, so it falls back too: "create a note, decide
 * against it right away, Ctrl+Z" has to work even though the cursor is sitting in that title field.
 */
export function useGlobalUndo(vault: Vault): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (!(isMac() ? e.metaKey : e.ctrlKey)) return
      const redo = key === 'y' || (key === 'z' && e.shiftKey)
      if (!redo && key !== 'z') return
      if (e.isComposing || e.keyCode === 229) return
      const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      const tag = active?.tagName
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && active!.value !== '') return
      if (e.defaultPrevented) return
      if (redo ? !vault.canRedo() : !vault.canUndo()) return
      e.preventDefault()
      if (redo) vault.redo()
      else vault.undo()
      // Undoing a note's creation (or redoing its trash) can remove the note that's currently open in the
      // editor. Left alone, openNoteId would still point at that now-gone id and the editor would be stuck
      // showing the "select or create a note" empty state with no obvious way out — fall back to another
      // live note (most recently edited) the same way closing/trashing the open note already does, or to
      // no note open at all if none are left.
      const openId = useUi.getState().openNoteId
      if (openId && !vault.getNote(openId)) {
        const next = [...vault.listNotes()].sort((a, b) => b.updatedAt - a.updatedAt)[0]
        useUi.setState({ openNoteId: next?.id ?? null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vault])
}
