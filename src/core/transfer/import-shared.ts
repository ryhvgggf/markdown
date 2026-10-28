import { isSvg, mediaKind, type MediaKind } from '@/core/attachments'
import { BLOCK_TYPES } from '@/core/blocks'
import { safeFileName } from '@/core/markdown/paths'
import type { FileEntry, PMNode } from '@/core/markdown/types'
import { normalizeTitle } from '@/core/vault/titles'
import type { Vault } from '@/core/vault/vault'
import type { Resolver } from './resolve'
import { MANIFEST_PATH, type ImportSource, type V2ManifestNote } from './types'

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  zip: 'application/zip', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const extOf = (path: string) => (/\.([^./]+)$/.exec(path)?.[1] ?? '').toLowerCase()
export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirParts = (path: string) => path.split('/').slice(0, -1).filter(Boolean)
export const isNotePath = (p: string) => /\.md$/i.test(p)

export function mimeOf(entry: FileEntry): string {
  return entry.blob?.type || MIME[extOf(entry.path)] || 'application/octet-stream'
}

/** Shown images and videos; SVG (never shown, see isSvg) and everything else are file blocks. */
export function kindOf(path: string, mime: string): MediaKind {
  return isSvg(mime, path) ? 'file' : mediaKind(mime)
}

export const noteEntries = (src: ImportSource) => src.entries.filter((e) => isNotePath(e.path) && e.text !== undefined)
export const fileEntries = (src: ImportSource) => src.entries.filter((e) => !isNotePath(e.path) && e.path !== MANIFEST_PATH && e.blob)

/** A note's title: manifest > source metadata > file name. */
export function titleOf(path: string, src: ImportSource, mn?: V2ManifestNote): string {
  return mn?.title ?? src.noteMeta?.get(path)?.title ?? baseName(path).replace(/\.md$/i, '')
}

/** Walks block ids in document order. */
export function blockIdsOf(doc: PMNode): string[] {
  const out: string[] = []
  const walk = (n: PMNode) => {
    if (BLOCK_TYPES.includes(n.type) && typeof n.attrs?.id === 'string') out.push(n.attrs.id)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

/** Sets block ids in document order (manifest restore of an unchanged file). */
export function applyBlockIds(doc: PMNode, ids: string[]): PMNode {
  let i = 0
  const walk = (n: PMNode): PMNode => {
    const next = BLOCK_TYPES.includes(n.type) && i < ids.length ? { ...n, attrs: { ...n.attrs, id: ids[i++] } } : n
    return next.content ? { ...next, content: next.content.map(walk) } : next
  }
  return walk(doc)
}

const plain = (n: PMNode): string => (n.text ?? '') + (n.content ?? []).map(plain).join('')

export function headingIds(doc: PMNode): Map<string, string> {
  const out = new Map<string, string>()
  for (const n of doc.content ?? []) {
    const id = n.attrs?.id
    if (n.type === 'heading' && typeof id === 'string') {
      const t = normalizeTitle(plain(n))
      if (!out.has(t)) out.set(t, id)
    }
  }
  return out
}

export type BatchNote = { path: string; title: string; noteId: string; doc: PMNode }

/**
 * Link targets resolve to notes in the same import first, then to notes already in the vault
 * (by title, then by the file-name form of the title). Attachments: relative to the note,
 * from the root, then by file name anywhere in the import.
 */
export function makeResolver(batch: BatchNote[], vault: Vault, attachments: Map<string, { id: string; kind: MediaKind }>): Resolver {
  const byTitle = new Map<string, BatchNote>()
  const byFile = new Map<string, BatchNote>()
  for (const b of batch) {
    byTitle.set(normalizeTitle(b.title), b)
    const f = normalizeTitle(baseName(b.path).replace(/\.md$/i, ''))
    if (!byFile.has(f)) byFile.set(f, b)
  }
  const existing = new Map(vault.listNotes().map((n) => [normalizeTitle(n.title), n.id]))
  const byId = new Map(batch.map((b) => [b.noteId, b]))
  const headings = new Map<string, Map<string, string>>()
  const byBase = new Map<string, { id: string; kind: MediaKind }>()
  for (const [path, a] of attachments) if (!byBase.has(baseName(path).toLowerCase())) byBase.set(baseName(path).toLowerCase(), a)

  return {
    note(title) {
      const t = normalizeTitle(title)
      if (!t) return null
      return byTitle.get(t)?.noteId ?? existing.get(t) ?? byFile.get(normalizeTitle(safeFileName(title)))?.noteId ?? null
    },
    heading(noteId, text) {
      const b = byId.get(noteId)
      if (!b) return null
      if (!headings.has(noteId)) headings.set(noteId, headingIds(b.doc))
      return headings.get(noteId)!.get(normalizeTitle(text)) ?? null
    },
    block(noteId, anchor) {
      const b = byId.get(noteId)
      return b && blockIdsOf(b.doc).includes(anchor) ? anchor : null
    },
    attachment(target, fromPath) {
      const clean = target.replace(/^\.\//, '')
      const rel = [...dirParts(fromPath), ...clean.split('/')].reduce<string[]>((acc, part) => {
        if (part === '..') acc.pop()
        else if (part && part !== '.') acc.push(part)
        return acc
      }, [])
      return attachments.get(rel.join('/')) ?? attachments.get(clean) ?? byBase.get(baseName(clean).toLowerCase()) ?? null
    },
  }
}

/** Titles in use (normalized); `take` returns `title` or `title (n)` and reserves it. O(1) per call. */
export function titleTaker(existing: Iterable<string>): { take(title: string): string; has(title: string): boolean } {
  const used = new Set([...existing].map(normalizeTitle))
  return {
    has: (t) => used.has(normalizeTitle(t)),
    take(title) {
      const base = title.trim()
      let out = base
      if (normalizeTitle(base) !== '') for (let n = 2; used.has(normalizeTitle(out)); n++) out = `${base} (${n})`
      used.add(normalizeTitle(out))
      return out
    },
  }
}

/** Lets the browser paint and handle input between chunks of work. */
export const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0))
