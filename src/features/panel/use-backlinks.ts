import { useMemo } from 'react'
import { useServices } from '@/app/services-context'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'
import type { LinkRow } from '@/adapters/storage/db'
import type { FolderMeta } from '@/core/vault/types'
import { useLive } from './use-live'

export interface BacklinkGroup {
  sourceId: string
  title: string
  folderPath: string
  blockId: string
  snippet: string
  /** Further links from the same note beyond the one shown. */
  extra: number
}

export function folderPath(folders: FolderMeta[], folderId: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const names: string[] = []
  for (let cur = folderId ? byId.get(folderId) : undefined, guard = 0; cur && guard < 50; guard++) {
    names.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return names.join(' / ')
}

/** Notes (one group per source note) that link to `noteId`, excluding self-links and trashed/purged sources. */
/** `undefined` while the first query for `noteId` is still loading. */
export function useBacklinks(noteId: string | null): BacklinkGroup[] | undefined {
  const { db } = useServices()
  const snap = useVaultSnapshot()
  const rows = useLive<LinkRow[]>(
    () => (noteId ? db.links.where('targetNoteId').equals(noteId).toArray() : []),
    [db, noteId],
  )
  return useMemo(() => {
    if (!rows) return undefined
    const live = new Map(snap.notes.map((n) => [n.id, n]))
    const groups = new Map<string, LinkRow[]>()
    for (const r of rows) {
      if (r.targetNoteId !== noteId || r.sourceNoteId === noteId || !live.has(r.sourceNoteId)) continue
      const list = groups.get(r.sourceNoteId)
      if (list) list.push(r)
      else groups.set(r.sourceNoteId, [r])
    }
    return [...groups.entries()]
      .map(([sourceId, list]): BacklinkGroup => {
        const note = live.get(sourceId)!
        return {
          sourceId,
          title: note.title,
          folderPath: folderPath(snap.folders, note.folderId),
          blockId: list[0].sourceBlockId,
          snippet: list[0].snippet,
          extra: list.length - 1,
        }
      })
      .sort((a, b) => live.get(b.sourceId)!.updatedAt - live.get(a.sourceId)!.updatedAt)
  }, [rows, snap, noteId])
}
