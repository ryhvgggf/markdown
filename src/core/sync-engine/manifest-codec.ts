import * as Y from 'yjs'
import type { AttachmentMeta, FolderMeta, NoteMeta } from '@/core/vault/types'
import type { StructureManifest } from './manifest'

/**
 * Encodes a `StructureManifest` as the full state of a fresh Yjs doc (`notes`/`folders` maps, same
 * field shape the local structure doc uses), so a downloading device can read it with ordinary Yjs
 * APIs. Built fresh on every call: per design doc §3.1 the manifest is always pushed as one wholesale
 * snapshot, never diffed or merged — there is nothing to apply an update against.
 */
export function encodeManifest(manifest: StructureManifest): Uint8Array {
  const doc = new Y.Doc()
  const notes = doc.getMap<Y.Map<unknown>>('notes')
  const folders = doc.getMap<Y.Map<unknown>>('folders')
  const attachments = doc.getMap<Y.Map<unknown>>('attachments')
  doc.transact(() => {
    for (const n of manifest.notes) notes.set(n.id, new Y.Map(Object.entries(n)))
    for (const f of manifest.folders) folders.set(f.id, new Y.Map(Object.entries(f)))
    for (const a of manifest.attachments ?? []) attachments.set(a.id, new Y.Map(Object.entries(a)))
  })
  return Y.encodeStateAsUpdate(doc)
}

/** Inverse of `encodeManifest` — reads a decrypted manifest doc state back into plain data. */
export function decodeManifest(update: Uint8Array): StructureManifest {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  const notes = [...doc.getMap<Y.Map<unknown>>('notes').values()].map((m) => Object.fromEntries(m.entries()) as NoteMeta)
  const folders = [...doc.getMap<Y.Map<unknown>>('folders').values()].map(
    (m) => Object.fromEntries(m.entries()) as FolderMeta,
  )
  const attachments = [...doc.getMap<Y.Map<unknown>>('attachments').values()].map(
    (m) => Object.fromEntries(m.entries()) as AttachmentMeta,
  )
  return { notes, folders, attachments }
}
