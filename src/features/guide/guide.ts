import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import { newId } from '@/core/ids'
import type { PMNode } from '@/core/markdown/types'
import { DIRTY_PREFIX } from '@/core/indexer/indexer'
import { dedupeTitle } from '@/core/vault/titles'
import type { Vault } from '@/core/vault/vault'
import { BLOCK_TYPES, createExtensions, type EditorContext } from '@/features/editor/extensions'
import type { NoteDocCache } from '@/core/note-doc/cache'
import { GUIDE_FOLDER, GUIDE_NOTES, GUIDE_VERSION, guideDoc, type GuideKey, type GuideRefs } from './guide-content'
import { assignBlockIds } from './pm-json'

export { GUIDE_FOLDER }
export const GUIDE_TITLES = GUIDE_NOTES.map((n) => n.title)

/**
 * The 「功能導覽」 folders that are still exactly as the app made them: top level, only guide notes (titles may
 * carry a ` (n)` suffix), none edited or synced. A new device that signs in gets its own guide first and then the
 * account's notes; this tells which guide can go without anyone losing anything.
 */
export function untouchedGuideFolderIds(vault: Vault): string[] {
  const base = (t: string) => t.replace(/ \(\d+\)$/, '')
  const folders = vault.listFolders()
  const notes = vault.listNotes()
  return folders
    .filter((f) => {
      if (f.parentId !== null || base(f.name) !== GUIDE_FOLDER || folders.some((x) => x.parentId === f.id)) return false
      const inside = notes.filter((n) => n.folderId === f.id)
      return (
        inside.length > 0 &&
        inside.length <= GUIDE_TITLES.length &&
        inside.every((n) => (GUIDE_TITLES as string[]).includes(base(n.title)) && !n.synced && n.updatedAt === n.createdAt)
      )
    })
    .map((f) => f.id)
}

/** meta flag: the guide was seeded once on this device (deleting it must not bring it back). */
export const GUIDE_SEEDED_KEY = 'guideSeeded'
/** Key in a guide note's own document meta (Yjs): the `GUIDE_VERSION` its text was written at. Missing = older. */
export const GUIDE_STAMP_KEY = 'guideVersion'
/** meta: the version `updateGuide` last found this device's guide at (saves reading every guide note on each start). */
export const GUIDE_CHECKED_KEY = 'guideChecked'
const DEMO_IMAGE_NAME = '範例圖片.png'

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
  const meta = vault.addAttachment({ filename: DEMO_IMAGE_NAME, mimeType: 'image/png', size: bytes.length })
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
    ydoc.getMap('meta').set(GUIDE_STAMP_KEY, GUIDE_VERSION)
    prosemirrorJSONToYXmlFragment(schema, json, ydoc.getXmlFragment('content'))
    await storage.appendUpdate(noteId, Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()
    await db.meta.put({ key: DIRTY_PREFIX + noteId, value: 1 })
  }
  await vault.flushWrites()
  return { folderId: folder.id, noteIds: GUIDE_NOTES.map((n) => ids.get(n.key)!) }
}

export type GuideUpdate = 'updated' | 'current' | 'none' | 'skipped'

/**
 * The guide is the app's own documentation, so an older one is brought up to `GUIDE_VERSION` even where the
 * user edited it (their own notes are never touched). It finds the guide by folder and title: every top-level
 * 「功能導覽」 folder, and in it the notes whose title (without a ` (n)` suffix) is a guide title. A note keeps
 * its id and title; a guide note that is missing is added to that folder. Each guide note carries the version
 * of its text in its own document (`GUIDE_STAMP_KEY`), which travels with sync, so a copy another device
 * already updated is not rewritten again. The whole folder is rewritten together (the notes link to each
 * other's blocks). Not done, and tried again later ('skipped'):
 * - while one of its notes is open in an editor;
 * - while one of its notes is synced and sync is not up to date (signed out, or still catching up): two devices
 *   rewriting the same synced note would end up with both texts.
 * A deleted guide stays deleted (資料 → 加入功能導覽筆記 adds a fresh one).
 */
export async function updateGuide(deps: {
  vault: Vault
  storage: StorageAdapter
  db: NotesDb
  notes: NoteDocCache
  /** Replaces a note's content (`DocIO.replace`: no change of the note's modified time). */
  replace: (noteId: string, doc: PMNode) => Promise<void>
  /** Whether sync is running and has caught up with the cloud. */
  syncSettled: () => boolean
}): Promise<GuideUpdate> {
  const { vault, storage, db, notes } = deps
  if (!(await db.meta.get(GUIDE_SEEDED_KEY))?.value) return 'none'
  const checked = (await db.meta.get(GUIDE_CHECKED_KEY))?.value
  if (typeof checked === 'number' && checked >= GUIDE_VERSION) return 'current'
  const base = (t: string) => t.replace(/ \(\d+\)$/, '')
  const keyOf = (title: string) => GUIDE_NOTES.find((g) => g.title === base(title))?.key
  const guides = vault
    .listFolders()
    .filter((f) => f.parentId === null && base(f.name) === GUIDE_FOLDER)
    .map((folder) => {
      const ids = new Map<GuideKey, string>()
      for (const n of vault.listNotes().filter((x) => x.folderId === folder.id)) {
        const key = keyOf(n.title)
        if (key && !ids.has(key)) ids.set(key, n.id)
      }
      return { folder, ids }
    })
    .filter((g) => g.ids.size > 0)
  if (!guides.length) return 'none'
  const matched = guides.flatMap((g) => [...g.ids.values()])
  if (matched.some((id) => notes.isInUse(id))) return 'skipped'
  if (matched.some((id) => vault.getNote(id)?.synced) && !deps.syncSettled()) return 'skipped'

  const stampOf = async (id: string): Promise<number> => {
    const ydoc = await notes.acquire(id)
    try {
      const v = ydoc.getMap('meta').get(GUIDE_STAMP_KEY)
      return typeof v === 'number' ? v : 0
    } finally {
      notes.release(id)
    }
  }
  const stale: typeof guides = []
  for (const g of guides) {
    let current = g.ids.size === GUIDE_NOTES.length
    for (const id of g.ids.values()) if ((await stampOf(id)) < GUIDE_VERSION) current = false
    if (!current) stale.push(g)
  }
  if (!stale.length) {
    await db.meta.put({ key: GUIDE_CHECKED_KEY, value: GUIDE_VERSION })
    return 'current'
  }

  const schema = guideSchema()
  const image =
    vault.listAttachments().find((a) => a.filename === DEMO_IMAGE_NAME && a.mimeType === 'image/png')?.id ?? (await storeDemoImage(vault, storage))
  for (const { folder, ids } of stale) {
    const taken = new Set(vault.listNotes().map((n) => n.title))
    for (const { key, title } of GUIDE_NOTES) {
      if (ids.has(key)) continue
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
      image,
    }
    for (const { key } of GUIDE_NOTES) {
      const id = ids.get(key)!
      const json = assignBlockIds(guideDoc(key, refs), BLOCK_TYPES, newId)
      schema.nodeFromJSON(json).check() // never store a document the editor cannot open
      await deps.replace(id, json)
      const ydoc = await notes.acquire(id)
      try {
        ydoc.getMap('meta').set(GUIDE_STAMP_KEY, GUIDE_VERSION)
      } finally {
        notes.release(id)
      }
    }
  }
  await notes.flushAll()
  await vault.flushWrites()
  await db.meta.put({ key: GUIDE_CHECKED_KEY, value: GUIDE_VERSION })
  return 'updated'
}
