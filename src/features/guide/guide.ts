import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import { newId } from '@/core/ids'
import { DIRTY_PREFIX } from '@/core/indexer/indexer'
import { dedupeTitle } from '@/core/vault/titles'
import type { Vault } from '@/core/vault/vault'
import { BLOCK_TYPES, createExtensions, type EditorContext } from '@/features/editor/extensions'
import { GUIDE_FOLDER, GUIDE_NOTES, guideDoc, type GuideKey, type GuideRefs } from './guide-content'
import { assignBlockIds } from './pm-json'

export { GUIDE_FOLDER }
export const GUIDE_TITLES = GUIDE_NOTES.map((n) => n.title)

/** meta flag: the guide was seeded once on this device (deleting it must not bring it back). */
export const GUIDE_SEEDED_KEY = 'guideSeeded'

/** 192 × 108 PNG (sky, sun, two hills) for the image demo. */
const DEMO_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMAAAABsCAIAAACzYCrFAAAByElEQVR42u3cvWkDQRCA0enEBTlQEQb36sAoMKgBF+ACHFiBwCg4Dmlv935mHnwVLC9Y2JmN8/ev1Fw4AgEkgASQAJIAEkACSABJAAkgASSAJIAEUPn+Lu/zAaRGOuszAighnTUZAZRZzwqGAEquZ7QhgPLrGWoIoBJ6xhkCCCCA6NnOEEAAAUTPdoYAAggggAASQAJIAAEEEEAAASSABBBAAAHEkLcwASTzQAABBBBDZqIXdXr9uMWQrYxGOvcxZC+sXQ9DNlMX0cHIbnwfPW5FfudYRKcgo50UmehgBFAfPQxVBNSRDkblAA3Sw1B+QEPprMbo5e1yC6CEdIYy+qdzH0A59XQ3NKmnlKEoRacjoxk6pRhFTT0LDT2op4KhqEmnmdFTdCowisp0nmLUTCc3o6DnEUNd9KQ0FOjMM+pIJyWjoGfG0CA9mQwFOpMNpZOJUaCzFZ0cjIKezfUc2lCgszmdQzMKevaj54iGAp19lhkQOhi1A6KHoUZA6GA0Aejz50tqDiABJIAEkACSABJAAkgASQAJIAEkgCSABJAAEkASQAJIAAkgASQBJIAEkACSABJAAkgASQAJIAEkgCSABJAA0uG7AgWSkAiO0O6yAAAAAElFTkSuQmCC'

export function guideSchema(): Schema {
  const ctx = { noteId: '' } as unknown as EditorContext
  return getSchema(createExtensions(new Y.Doc(), ctx))
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function storeDemoImage(vault: Vault, storage: StorageAdapter): Promise<string | null> {
  const bytes = base64Bytes(DEMO_PNG_B64)
  const meta = vault.addAttachment({ filename: '範例圖片.png', mimeType: 'image/png', size: bytes.length })
  try {
    await storage.putBlob(meta.id, new Blob([bytes as BlobPart], { type: 'image/png' }))
    return meta.id
  } catch {
    vault.removeAttachment(meta.id)
    return null // the guide still works without its picture
  }
}

/**
 * Creates the 「功能導覽」 folder with the guide notes (titles get the vault's usual ` (n)` suffix when
 * taken) and writes each note's content as a Yjs update, built from ProseMirror JSON in the editor's
 * schema. Every note is marked dirty, so the indexer picks it up on its next catch-up.
 */
export async function addGuide(deps: { vault: Vault; storage: StorageAdapter; db: NotesDb }): Promise<{ folderId: string; noteIds: string[] }> {
  const { vault, storage, db } = deps
  const schema = guideSchema()
  const rootFolders = new Set(vault.listFolders().filter((f) => f.parentId === null).map((f) => f.name))
  const folder = vault.createFolder({ name: dedupeTitle(GUIDE_FOLDER, rootFolders), parentId: null })

  const taken = new Set(vault.listNotes().map((n) => n.title))
  const ids = new Map<GuideKey, string>()
  for (const { key, title } of GUIDE_NOTES) {
    const unique = dedupeTitle(title, taken)
    taken.add(unique)
    ids.set(key, vault.createNote({ title: unique, folderId: folder.id }).id)
  }

  const blockIds = new Map<string, string>()
  const refs: GuideRefs = {
    note: (key) => ids.get(key)!,
    block: (key, name) => {
      const k = `${key}#${name}`
      if (!blockIds.has(k)) blockIds.set(k, newId())
      return blockIds.get(k)!
    },
    image: await storeDemoImage(vault, storage),
  }

  for (const { key } of GUIDE_NOTES) {
    const noteId = ids.get(key)!
    const json = assignBlockIds(guideDoc(key, refs), BLOCK_TYPES, newId)
    schema.nodeFromJSON(json).check() // never store a document the editor cannot open
    const ydoc = new Y.Doc()
    ydoc.getMap('meta').set('schemaVersion', 1)
    prosemirrorJSONToYXmlFragment(schema, json, ydoc.getXmlFragment('content'))
    await storage.appendUpdate(noteId, Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()
    await db.meta.put({ key: DIRTY_PREFIX + noteId, value: 1 })
  }
  await vault.flushWrites()
  return { folderId: folder.id, noteIds: GUIDE_NOTES.map((n) => ids.get(n.key)!) }
}
