import { useEffect } from 'react'
import { useUi } from '@/app/ui-store'
import type { Vault } from '@/core/vault/vault'

/**
 * Keeps a note open whenever the vault has one. The open id can end up pointing at nothing (the note was
 * purged, replaced by a restore or import, or removed in another tab), or be null while notes exist; the
 * editor would then show "選擇或新增一篇筆記" with notes sitting in the sidebar. Fall back to the most
 * recently edited note, as startup does. With no notes at all nothing is opened.
 */
export function useEnsureOpenNote(vault: Vault): void {
  useEffect(() => {
    const check = () => {
      const id = useUi.getState().openNoteId
      if (id && vault.getNote(id)) return
      const next = [...vault.listNotes()].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (next) useUi.setState({ openNoteId: next.id })
    }
    check()
    const offVault = vault.observe(check)
    const offUi = useUi.subscribe(check)
    return () => {
      offVault()
      offUi()
    }
  }, [vault])
}
