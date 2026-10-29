import { useEffect } from 'react'
import type { Vault } from '@/core/vault/vault'
import { isMac } from '@/features/rail/use-rail'

/**
 * App-wide Ctrl/⌘+Z. The note editor's own Yjs undo (from `Collaboration`) handles content edits and calls
 * `preventDefault()` when it does; whenever that doesn't happen — nothing focused in an editor, or that
 * note's own history is empty — this falls back to undoing the last sidebar action (create/rename/move/
 * trash/restore a note or folder; see `Vault.asUserAction`). A plain text input (e.g. a rename field) is
 * left to the browser's native field undo.
 */
export function useGlobalUndo(vault: Vault): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (!(isMac() ? e.metaKey : e.ctrlKey)) return
      const redo = key === 'y' || (key === 'z' && e.shiftKey)
      if (!redo && key !== 'z') return
      if (e.isComposing || e.keyCode === 229) return
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.defaultPrevented) return
      if (redo ? !vault.canRedo() : !vault.canUndo()) return
      e.preventDefault()
      if (redo) vault.redo()
      else vault.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vault])
}
