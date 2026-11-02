import type { AttachmentMeta, FolderMeta, NoteMeta } from '@/core/vault/types'

export interface StructureManifest {
  notes: NoteMeta[]
  folders: FolderMeta[]
  /** Metadata (name, type, size) of attachments synced notes use, so another device can show them (3f-3).
   *  The bytes travel separately (`attachment-sync.ts`). Absent in manifests pushed before 3f-3. */
  attachments?: AttachmentMeta[]
  /** Notes someone deliberately took out of the cloud (permanent delete, or sync turned off), with when.
   *  A device that still has such a note marked synced stops syncing it (keeping its content) instead of
   *  uploading it again. Kept for `TOMBSTONE_TTL_MS`. Absent in manifests pushed before 3f-4. */
  removed?: Array<{ id: string; at: number }>
}

/** How long a removal mark stays in the manifest — a device offline longer than this may re-upload a note removed elsewhere. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000

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
    // A folder's own sync rule stays on this device, so it isn't part of what the cloud sees.
    folders: folders.filter((f) => neededFolderIds.has(f.id)).map((f) => withoutSyncRule(f)),
  }
}

function withoutSyncRule(f: FolderMeta): FolderMeta {
  const out = { ...f }
  delete out.synced
  return out
}
