import { useCallback, useMemo } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { focusTitleEnd } from '@/features/editor/focus-bridge'
import type { TreeNode } from '@/core/vault/tree'
import { VaultError } from '@/core/vault/types'
import type { Move, Ref } from './dnd'
import type { TrashRef } from './TrashView'

/** Focuses the title of a just-created note once its editor has mounted. */
function focusTitleSoon(noteId: string): void {
  let tries = 0
  const tick = () => {
    if (focusTitleEnd(noteId) || ++tries > 30) return
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function noteOrder(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'note' ? [n.note.id] : noteOrder(n.children)))
}

export type RenameResult = 'ok' | 'duplicate'

export function useActions(tree: TreeNode[], expand: (ids: string[]) => void) {
  const { vault, maintenance } = useServices()

  const ancestors = useCallback(
    (folderId: string | null): string[] => {
      const ids: string[] = []
      const byId = new Map(vault.listFolders().map((f) => [f.id, f]))
      for (let p = folderId; p; p = byId.get(p)?.parentId ?? null) ids.push(p)
      return ids
    },
    [vault],
  )

  return useMemo(() => {
    const openNote = (id: string) => {
      useUi.getState().openNote(id)
      useUi.getState().setSidebarOverlay(false)
    }
    return {
      openNote,
      /** `folderId` undefined: the folder of the open note (or the root). */
      createNote(folderId?: string | null): void {
        const open = useUi.getState().openNoteId
        const target = folderId !== undefined ? folderId : ((open && vault.getNote(open)?.folderId) ?? null)
        const note = vault.createNote({ title: '', folderId: target })
        expand(ancestors(target))
        openNote(note.id)
        focusTitleSoon(note.id)
      },
      createFolder(parentId: string | null): string {
        const folder = vault.createFolder({ name: '新資料夾', parentId })
        expand(ancestors(parentId))
        return folder.id
      },
      rename(ref: Ref, value: string): RenameResult {
        const v = value.trim()
        if (ref.kind === 'note') {
          if (v === (vault.getNote(ref.id)?.title ?? '')) return 'ok'
          if (!vault.isTitleAvailable(v, ref.id)) return 'duplicate'
          vault.renameNote(ref.id, v)
        } else if (v !== '') vault.renameFolder(ref.id, v)
        return 'ok'
      },
      trash(node: TreeNode): void {
        const order = noteOrder(tree)
        const open = useUi.getState().openNoteId
        if (node.kind === 'note') vault.trashNote(node.note.id)
        else vault.trashFolder(node.folder.id)
        if (!open || vault.getNote(open)?.deletedAt === null) return
        const at = order.indexOf(open)
        const live = (id: string) => vault.getNote(id)?.deletedAt === null
        const next = order.slice(at + 1).find(live) ?? order.slice(0, Math.max(at, 0)).reverse().find(live) ?? null
        if (next) openNote(next)
        else useUi.setState({ openNoteId: null })
      },
      move(drag: Ref, to: Move): void {
        try {
          if (drag.kind === 'note') vault.moveNote(drag.id, { folderId: to.parentId, index: to.index })
          else vault.moveFolder(drag.id, { parentId: to.parentId, index: to.index })
          expand(ancestors(to.parentId))
        } catch (e) {
          if (!(e instanceof VaultError && e.code === 'cycle')) throw e
        }
      },
      restore(ref: TrashRef): void {
        if (ref.kind === 'note') vault.restoreNote(ref.id)
        else if (ref.kind === 'folder') vault.restoreFolder(ref.id)
        else if (vault.getAttachment(ref.id)) vault.restoreAttachment(ref.id) // another tab may have purged it
      },
      /** Permanent delete; crash-safe and never rejects (failures reach the storage banner). */
      purge(ref: TrashRef): Promise<boolean> {
        return ref.kind === 'attachment' ? maintenance.purgeAttachment(ref.id) : maintenance.purge({ kind: ref.kind, id: ref.id })
      },
      /** Moves an attachment to the trash (any time, used or not); notes using it show it as trashed. */
      trashAttachment(id: string): void {
        vault.trashAttachment(id)
      },
    }
  }, [vault, maintenance, tree, expand, ancestors])
}
