import type { StorageAdapter } from '@/adapters/storage/types'
import { onIdle } from '@/core/idle'
import { hashText, localDate, noteFilePath, safeFileName, uniqueName } from '@/core/markdown/paths'
import type { FileEntry, PMNode } from '@/core/markdown/types'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import type { Vault } from '@/core/vault/vault'
import { blockIdsOf } from './import-shared'
import type { TransferClient } from './transfer-client'
import type { SharedContext } from './transfer-ops'
import { MANIFEST_PATH, type DocIO, type V2Manifest } from './types'

export type ExportScope = { kind: 'vault' } | { kind: 'folder'; folderId: string } | { kind: 'note'; noteId: string }
export type ExportOptions = {
  includeUnusedAttachments: boolean
  /** Whether the manifest carries every note's exact document (ZIP: yes; mirror: no). */
  includeDocs: boolean
}
export type ExportDeps = { vault: Vault; storage: StorageAdapter; docs: DocIO; client: Pick<TransferClient, 'serialize'> }

export const VAULT_NAME = '我的知識庫'
export const ATTACHMENT_DIR = '附件'
const READ_YIELD = 20
const SERIALIZE_BATCH = 50

/**
 * Whether a note holds something its Markdown cannot (spec 6.4): only then does the manifest carry the
 * whole document. Everything else comes back exactly from the .md plus the block ids.
 */
export function needsExactDoc(doc: PMNode): boolean {
  let lossy = false
  walk(doc, (n) => {
    if (lossy) return
    if (n.marks?.some((m) => m.type === 'textStyle' || (m.type === 'highlight' && m.attrs?.color && m.attrs.color !== '#FFF1A8'))) lossy = true
    else if (n.type === 'media' && n.attrs?.width != null) lossy = true
    else if (n.type === 'orderedList' && n.attrs?.listStyle && n.attrs.listStyle !== 'auto') lossy = true
    else if ((n.type === 'tableCell' || n.type === 'tableHeader') && (Array.isArray(n.attrs?.colwidth) || (n.content ?? []).some((c) => c.type !== 'paragraph'))) lossy = true
  })
  return lossy
}

const idle = () => new Promise<void>((r) => onIdle(r))
const plain = (n: PMNode): string => (n.text ?? '') + (n.content ?? []).map(plain).join('')

/** Folder names from the scope root down to `folderId` (inclusive). */
function folderChain(folderId: string | null, byId: Map<string, FolderMeta>, stopAt: string | null): string[] {
  const out: string[] = []
  for (let id = folderId, guard = 0; id && guard < 100; guard++) {
    const f = byId.get(id)
    if (!f) break
    out.unshift(f.name)
    if (id === stopAt) break
    id = f.parentId
  }
  return out
}

function walk(n: PMNode, fn: (n: PMNode) => void): void {
  fn(n)
  n.content?.forEach((c) => walk(c, fn))
}

/** Notes and folders of a scope, in a stable order (folder path, then the vault's sibling order). */
export function scopeItems(vault: Vault, scope: ExportScope): { notes: NoteMeta[]; folders: FolderMeta[]; root: string | null } {
  const folders = vault.listFolders()
  const byParent = new Map<string | null, FolderMeta[]>()
  for (const f of folders) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f])
  const notesIn = new Map<string | null, NoteMeta[]>()
  for (const n of vault.listNotes()) notesIn.set(n.folderId, [...(notesIn.get(n.folderId) ?? []), n])
  const byOrder = <T extends { order: string }>(xs: T[]) => [...xs].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

  if (scope.kind === 'note') {
    const n = vault.getNote(scope.noteId)
    return { notes: n && n.deletedAt === null ? [n] : [], folders: [], root: null }
  }
  const outNotes: NoteMeta[] = []
  const outFolders: FolderMeta[] = []
  const visit = (parent: string | null) => {
    outNotes.push(...byOrder(notesIn.get(parent) ?? []))
    for (const f of byOrder(byParent.get(parent) ?? [])) {
      outFolders.push(f)
      visit(f.id)
    }
  }
  if (scope.kind === 'vault') {
    visit(null)
    return { notes: outNotes, folders: outFolders, root: null }
  }
  const top = folders.find((f) => f.id === scope.folderId)
  if (!top) return { notes: [], folders: [], root: null }
  outFolders.push(top)
  visit(top.id)
  return { notes: outNotes, folders: outFolders, root: top.id }
}

/** The vault (or part of it) as files: `.md` per note, `附件/…`, and `.notes-v2.json` last. */
export async function* exportEntries(scope: ExportScope, opts: ExportOptions, deps: ExportDeps): AsyncGenerator<FileEntry> {
  const { vault, storage, docs, client } = deps
  const { notes, folders, root } = scopeItems(vault, scope)
  const byId = new Map(vault.listFolders().map((f) => [f.id, f]))

  // Read every document (yielding to the UI now and then).
  const docOf = new Map<string, PMNode>()
  for (let i = 0; i < notes.length; i += READ_YIELD) {
    const batch = notes.slice(i, i + READ_YIELD)
    const read = await Promise.all(batch.map((n) => docs.read(n.id))) // storage reads pipeline
    batch.forEach((n, k) => docOf.set(n.id, read[k]))
    await idle()
  }

  // Paths.
  const taken = new Set<string>()
  const pathOf = new Map<string, string>()
  for (const n of notes) pathOf.set(n.id, noteFilePath(scope.kind === 'note' ? [] : folderChain(n.folderId, byId, root), n.title, taken))

  // Links: heading text of targets, blocks that need an anchor, attachments in use.
  const headings: Record<string, string> = {}
  const anchored = new Map<string, Set<string>>()
  const used = new Set<string>()
  const blockInfo = new Map<string, { heading: string | null }>()
  for (const [noteId, d] of docOf) walk(d, (n) => {
    if (typeof n.attrs?.id === 'string') blockInfo.set(`${noteId}#${n.attrs.id}`, { heading: n.type === 'heading' ? plain(n) : null })
  })
  for (const d of docOf.values()) walk(d, (n) => {
    if (n.type === 'media') used.add(n.attrs?.attachmentId as string)
    if (n.type === 'noteLink' && n.attrs?.blockId) {
      const key = `${n.attrs.noteId as string}#${n.attrs.blockId as string}`
      const info = blockInfo.get(key)
      if (info?.heading != null) headings[key] = info.heading
      else if (info) {
        const set = anchored.get(n.attrs.noteId as string) ?? new Set()
        set.add(n.attrs.blockId as string)
        anchored.set(n.attrs.noteId as string, set)
      }
    }
  })

  // Attachments.
  const attachments = vault.listAttachments().filter((a) => (opts.includeUnusedAttachments && scope.kind === 'vault') || used.has(a.id))
  const attPath: Record<string, string> = {}
  const attTaken = new Set<string>()
  for (const a of attachments) {
    const dot = a.filename.lastIndexOf('.')
    const stem = safeFileName(dot > 0 ? a.filename.slice(0, dot) : a.filename)
    const ext = dot > 0 ? a.filename.slice(dot).replace(/[^.\p{L}\p{N}_-]/gu, '') : ''
    const name = uniqueName(`${ATTACHMENT_DIR}/${stem}`, attTaken, ext) + ext
    attTaken.add(name.toLowerCase())
    attPath[a.id] = name
  }

  // Markdown.
  const titles = Object.fromEntries(vault.listNotes({ includeTrashed: true }).map((n) => [n.id, n.title]))
  const shared: SharedContext = { titles, headings, attachments: attPath }
  const manifest: V2Manifest = {
    format: 'notes-v2', version: 1, exportedAt: Date.now(), notes: [] as V2Manifest['notes'],
    folders: folders.map((f, i) => ({ id: f.id, path: folderChain(f.id, byId, root).join('/'), order: i })),
    attachments: attachments.map((a) => ({ id: a.id, path: attPath[a.id], filename: a.filename, mimeType: a.mimeType, createdAt: a.createdAt })),
  }
  const noteJson: string[] = []
  for (let i = 0; i < notes.length; i += SERIALIZE_BATCH) {
    const batch = notes.slice(i, i + SERIALIZE_BATCH)
    const texts = await client.serialize(batch.map((n) => ({ doc: docOf.get(n.id)!, anchored: [...(anchored.get(n.id) ?? [])] })), shared)
    for (let k = 0; k < batch.length; k++) {
      const n = batch[k]
      const d = docOf.get(n.id)!
      // One note at a time: a single JSON.stringify of every document would block the page.
      noteJson.push(JSON.stringify({
        id: n.id, path: pathOf.get(n.id)!, title: n.title, createdAt: n.createdAt, updatedAt: n.updatedAt,
        mdHash: hashText(texts[k]), blockIds: blockIdsOf(d), ...(opts.includeDocs && needsExactDoc(d) && { doc: d }),
      }))
      yield { path: pathOf.get(n.id)!, text: texts[k], mtime: n.updatedAt }
    }
  }
  for (const a of attachments) {
    const blob = await storage.getBlob(a.id)
    if (blob) yield { path: attPath[a.id], blob, mtime: a.createdAt }
  }
  const head = JSON.stringify(manifest)
  yield { path: MANIFEST_PATH, text: head.replace('"notes":[]', () => `"notes":[${noteJson.join(',')}]`) }
}

/** A ZIP of the scope; a single note is its own `.md` file. */
export async function exportFile(
  scope: ExportScope,
  opts: ExportOptions,
  deps: ExportDeps & { writeZip(entries: AsyncIterable<FileEntry>): Promise<Blob> },
): Promise<{ blob: Blob; fileName: string }> {
  if (scope.kind === 'note') {
    for await (const e of exportEntries(scope, { ...opts, includeDocs: false }, deps)) {
      if (e.text !== undefined && e.path !== MANIFEST_PATH) return { blob: new Blob([e.text], { type: 'text/markdown' }), fileName: e.path }
    }
    throw new Error('找不到這篇筆記')
  }
  const name = scope.kind === 'folder' ? safeFileName(deps.vault.listFolders().find((f) => f.id === scope.folderId)?.name ?? VAULT_NAME) : VAULT_NAME
  return { blob: await deps.writeZip(exportEntries(scope, opts, deps)), fileName: `${name}-${localDate(Date.now())}.zip` }
}
