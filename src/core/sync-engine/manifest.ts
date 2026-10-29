import type { FolderMeta, NoteMeta } from '@/core/vault/types'

export interface StructureManifest {
  notes: NoteMeta[]
  folders: FolderMeta[]
}

/**
 * Phase 3 design doc §3.1: derive the cloud-safe structure manifest from the local structure doc.
 * Uploading the local structure wholesale would leak which un-synced notes exist and their titles, so
 * the cloud only ever sees this derived version: the synced notes themselves, plus the folder chain
 * needed to place them (ancestors up to root). A folder that holds no synced note — directly or via a
 * descendant folder — is left out entirely, same as every un-synced note.
 *
 * Pure and side-effect free: building this into a Yjs doc, encrypting it, and pushing/re-running it on
 * every change to `synced` or to the structure is `core/sync-engine`'s job, not this function's.
 */
export function deriveManifest(notes: readonly NoteMeta[], folders: readonly FolderMeta[]): StructureManifest {
  const syncedNotes = notes.filter((n) => n.synced)
  const byId = new Map(folders.map((f) => [f.id, f]))
  const neededFolderIds = new Set<string>()
  for (const note of syncedNotes) {
    let id = note.folderId
    while (id !== null && !neededFolderIds.has(id)) {
      neededFolderIds.add(id)
      id = byId.get(id)?.parentId ?? null
    }
  }
  return {
    notes: syncedNotes,
    folders: folders.filter((f) => neededFolderIds.has(f.id)),
  }
}
