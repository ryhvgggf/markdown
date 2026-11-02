import type { Vault } from '@/core/vault/vault'
import type { AttachmentMeta, FolderMeta, NoteMeta } from '@/core/vault/types'
import type { StructureManifest } from './manifest'

export interface ManifestConflict {
  noteId: string
  /** 'id-collision': an unrelated local note already uses this id (different `createdAt`). 'create-failed':
   *  the id was genuinely missing locally, but creating it failed for some other reason (e.g. its folder
   *  never got created) — distinct from 'id-collision' so a caller reporting this doesn't misdescribe it. */
  reason: 'id-collision' | 'create-failed'
}

export interface ManifestMergeResult {
  /** Manifest notes left untouched; see `ManifestConflict.reason` for why each one was skipped. */
  conflicts: ManifestConflict[]
}

const at = (v: number | undefined) => v ?? 0

/**
 * Applies a pulled structure manifest onto the local vault (design doc §8 manifest pull; two-way since 3f-3).
 *
 * - An id the local vault completely lacks is created (folders parent-first, then notes, marked synced).
 * - An id that exists locally is the same record only if `createdAt` matches too (ids are nanoid(21) — a
 *   genuine collision is astronomically unlikely, not impossible); on a mismatch the local record is left
 *   alone and, for notes, reported in `conflicts`.
 * - For the same record, title and placement (folder + order) are last-writer-wins on their own stamps
 *   (`titleAt`/`placeAt`, folders `nameAt`/`placeAt`): the manifest's value is applied only when its stamp
 *   is strictly newer than the local one. Only notes that are synced here (`synced: true`) are updated — a
 *   note whose sync was turned off on this device is never touched.
 * - A title that collides with another local note is kept with a ` (n)` suffix on this device (see
 *   `Vault.applyRemoteNote`), instead of the note not appearing at all.
 * - Trash state is not merged: trashing stays a per-device action (out of 3f-3's scope).
 */
export function mergeManifestIntoVault(vault: Vault, manifest: StructureManifest): ManifestMergeResult {
  const conflicts: ManifestConflict[] = []

  const localFolders = new Map(vault.listFolders({ includeTrashed: true }).map((f) => [f.id, f]))
  const missingFolders = manifest.folders.filter((f) => !localFolders.has(f.id))
  const created = new Set<string>()
  // Parent-first: a missing folder may depend on an ancestor that's also missing. `deriveManifest` always
  // includes a synced note's full folder ancestry, so this converges in at most `missingFolders.length` passes.
  for (let pass = 0; created.size < missingFolders.length && pass <= missingFolders.length; pass++) {
    for (const f of missingFolders) {
      if (created.has(f.id)) continue
      const parentReady = f.parentId === null || localFolders.has(f.parentId) || created.has(f.parentId)
      if (!parentReady) continue
      vault.createFolder({ id: f.id, name: f.name, parentId: f.parentId, createdAt: f.createdAt })
      vault.applyRemoteFolder(f.id, { order: f.order, nameAt: f.nameAt, placeAt: f.placeAt })
      created.add(f.id)
    }
  }

  // Existing folders: name and placement, newest stamp wins. Placement is applied after every rename/create
  // above, so a move into a folder this same manifest just created works.
  for (const f of manifest.folders) {
    const local = localFolders.get(f.id)
    if (!local || local.createdAt !== f.createdAt) continue
    const patch: Parameters<Vault['applyRemoteFolder']>[1] = {}
    if (at(f.nameAt) > at(local.nameAt)) Object.assign(patch, { name: f.name, nameAt: f.nameAt })
    if (at(f.placeAt) > at(local.placeAt)) Object.assign(patch, { parentId: f.parentId, order: f.order, placeAt: f.placeAt })
    if (Object.keys(patch).length > 0) vault.applyRemoteFolder(f.id, patch)
  }

  for (const note of manifest.notes) {
    const local = vault.getNote(note.id)
    if (local) {
      if (local.createdAt !== note.createdAt) {
        conflicts.push({ noteId: note.id, reason: 'id-collision' }) // same id, unrelated note — leave it alone
        continue
      }
      if (!local.synced) continue // sync turned off on this device: never touched
      const patch = notePatch(local, note)
      if (patch) vault.applyRemoteNote(note.id, patch)
      continue
    }
    try {
      // Created untitled, then titled through `applyRemoteNote`, so a title taken locally gets a suffix
      // rather than failing the whole note.
      vault.createNote({ id: note.id, title: '', folderId: note.folderId, createdAt: note.createdAt, updatedAt: note.updatedAt })
      vault.applyRemoteNote(note.id, { title: note.title, titleAt: note.titleAt, order: note.order, placeAt: note.placeAt })
      vault.setNoteSynced(note.id, true) // it came from the manifest, so it's synced by definition
    } catch {
      conflicts.push({ noteId: note.id, reason: 'create-failed' }) // e.g. its folder never got created above
    }
  }

  return { conflicts }
}

function notePatch(local: NoteMeta, remote: NoteMeta): Parameters<Vault['applyRemoteNote']>[1] | null {
  const patch: Parameters<Vault['applyRemoteNote']>[1] = {}
  if (at(remote.titleAt) > at(local.titleAt)) Object.assign(patch, { title: remote.title, titleAt: remote.titleAt })
  if (at(remote.placeAt) > at(local.placeAt)) Object.assign(patch, { folderId: remote.folderId, order: remote.order, placeAt: remote.placeAt })
  return Object.keys(patch).length > 0 ? patch : null
}

/** Attachment metadata in the manifest that this vault doesn't have yet (the caller downloads the bytes first). */
export function missingAttachments(vault: Vault, manifest: StructureManifest): AttachmentMeta[] {
  return (manifest.attachments ?? []).filter((a) => !vault.getAttachment(a.id))
}

/**
 * What this device pushes as the new cloud manifest: its own local view, combined with the cloud's current one
 * so nothing is lost by a read-modify-write.
 * - Cloud entries this device doesn't have locally are kept, unless deliberately removed here (`removedNoteIds`)
 *   — a note merely missing locally (a bug, data loss) must not delete its cloud copy (3e).
 * - For entries both sides have, each field group takes whichever side's stamp is newer; a tie keeps the
 *   cloud's value, so a local-only adjustment (a ` (n)` title suffix from `applyRemoteNote`) never spreads.
 * Notes that aren't `synced` locally stay local-only — `deriveManifest` filters them out afterwards.
 */
export function combineManifests(
  local: { notes: readonly NoteMeta[]; folders: readonly FolderMeta[]; attachments: readonly AttachmentMeta[] },
  cloud: StructureManifest | null,
  removedNoteIds: ReadonlySet<string>,
): { notes: NoteMeta[]; folders: FolderMeta[]; attachments: AttachmentMeta[] } {
  const cloudNotes = new Map((cloud?.notes ?? []).map((n) => [n.id, n]))
  const cloudFolders = new Map((cloud?.folders ?? []).map((f) => [f.id, f]))
  const localNoteIds = new Set(local.notes.map((n) => n.id))
  const localFolderIds = new Set(local.folders.map((f) => f.id))

  const notes = local.notes.map((n) => {
    const c = cloudNotes.get(n.id)
    if (!c || c.createdAt !== n.createdAt) return n
    const out = { ...n }
    if (at(c.titleAt) >= at(n.titleAt)) Object.assign(out, { title: c.title, titleAt: c.titleAt })
    if (at(c.placeAt) >= at(n.placeAt)) Object.assign(out, { folderId: c.folderId, order: c.order, placeAt: c.placeAt })
    return dropUndefined(out)
  })
  for (const c of cloudNotes.values()) if (!localNoteIds.has(c.id) && !removedNoteIds.has(c.id)) notes.push(c)

  const folders = local.folders.map((f) => {
    const c = cloudFolders.get(f.id)
    if (!c || c.createdAt !== f.createdAt) return f
    const out = { ...f }
    if (at(c.nameAt) >= at(f.nameAt)) Object.assign(out, { name: c.name, nameAt: c.nameAt })
    if (at(c.placeAt) >= at(f.placeAt)) Object.assign(out, { parentId: c.parentId, order: c.order, placeAt: c.placeAt })
    return dropUndefined(out)
  })
  for (const c of cloudFolders.values()) if (!localFolderIds.has(c.id)) folders.push(c)

  const localAttachmentIds = new Set(local.attachments.map((a) => a.id))
  const attachments = [...local.attachments, ...(cloud?.attachments ?? []).filter((a) => !localAttachmentIds.has(a.id))]

  return { notes, folders, attachments }
}

/** Yjs maps can't hold `undefined`; drop keys a cloud entry without stamps would have set to it. */
function dropUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

/**
 * True when the cloud manifest is missing something this device's local view would contribute — a synced
 * note or folder it lacks, or a field this device changed more recently. Lets a device whose push lost a
 * read-modify-write race (two devices pushing at once) notice on the next pull and push again.
 */
export function cloudIsBehind(derived: StructureManifest, cloud: StructureManifest): boolean {
  const cloudNotes = new Map(cloud.notes.map((n) => [n.id, n]))
  const cloudFolders = new Map(cloud.folders.map((f) => [f.id, f]))
  for (const n of derived.notes) {
    const c = cloudNotes.get(n.id)
    if (!c) return true
    if (c.createdAt !== n.createdAt) continue
    if (at(n.titleAt) > at(c.titleAt) || at(n.placeAt) > at(c.placeAt)) return true
  }
  for (const f of derived.folders) {
    const c = cloudFolders.get(f.id)
    if (!c) return true
    if (c.createdAt !== f.createdAt) continue
    if (at(f.nameAt) > at(c.nameAt) || at(f.placeAt) > at(c.placeAt)) return true
  }
  const cloudAttachments = new Set((cloud.attachments ?? []).map((a) => a.id))
  for (const a of derived.attachments ?? []) if (!cloudAttachments.has(a.id)) return true
  return false
}
