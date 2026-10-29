import type { Vault } from '@/core/vault/vault'
import type { StructureManifest } from './manifest'

export interface ManifestMergeResult {
  /** Ids of manifest notes left untouched because an unrelated local note already uses that id (different `createdAt`). */
  conflicts: string[]
}

/**
 * Applies a pulled structure manifest onto the local vault — the "already-running device" half of the
 * design doc's §8 manifest pull, deliberately left out of `sync-manager.ts`'s original 3d pass and
 * resolved by direct discussion rather than invented here. Creates whatever note or folder the manifest
 * has that the local vault completely lacks; never touches an id the local vault already has, for any
 * reason.
 *
 * Settled rules (not guessed):
 * - A desync-then-resync on one device is a non-issue by construction: this only ever *creates* ids the
 *   local vault has literally never seen, so a note whose sync was deliberately turned off locally
 *   (`synced: false`, but the id already exists) is never touched or resurrected.
 * - An id that exists locally AND in the manifest is the same note only if `createdAt` matches too (ids
 *   are nanoid(21) — a genuine collision between two unrelated notes is astronomically unlikely, not
 *   impossible). On a mismatch the local note is left completely untouched and its id is returned in
 *   `conflicts` for the caller to report; no auto-rename, no UI — not worth it for this probability.
 * - Deliberately does NOT propagate a title/folder change made on another device onto a note already
 *   synced on *this* device (`synced: true` locally already) — that's a different, broader "live
 *   structure sync for already-bound notes" problem that was never asked for here. This only creates.
 */
export function mergeManifestIntoVault(vault: Vault, manifest: StructureManifest): ManifestMergeResult {
  const conflicts: string[] = []

  const localFolderIds = new Set(vault.listFolders({ includeTrashed: true }).map((f) => f.id))
  const missingFolders = manifest.folders.filter((f) => !localFolderIds.has(f.id))
  const created = new Set<string>()
  // Parent-first: a missing folder may depend on an ancestor that's also missing. `deriveManifest` always
  // includes a synced note's full folder ancestry, so this always converges in at most `missingFolders.length`
  // passes — the guard just bounds that, it never needs to actually kick in.
  for (let pass = 0; created.size < missingFolders.length && pass <= missingFolders.length; pass++) {
    for (const f of missingFolders) {
      if (created.has(f.id)) continue
      const parentReady = f.parentId === null || localFolderIds.has(f.parentId) || created.has(f.parentId)
      if (!parentReady) continue
      vault.createFolder({ id: f.id, name: f.name, parentId: f.parentId, createdAt: f.createdAt })
      created.add(f.id)
    }
  }

  for (const note of manifest.notes) {
    const local = vault.getNote(note.id)
    if (local) {
      if (local.createdAt !== note.createdAt) conflicts.push(note.id) // same id, unrelated note — leave it alone
      continue // same note either way (already here, or a genuine collision) — nothing to create
    }
    try {
      vault.createNote({ id: note.id, title: note.title, folderId: note.folderId, createdAt: note.createdAt, updatedAt: note.updatedAt })
      vault.setNoteSynced(note.id, true) // it came from the manifest, so it's synced by definition
    } catch {
      conflicts.push(note.id) // e.g. title collides with an unrelated local note, or its folder never got created above
    }
  }

  return { conflicts }
}
