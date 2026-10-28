import { noteFilePath, safeFileName, uniqueName } from '@/core/markdown/paths'
import type { FileEntry } from '@/core/markdown/types'
import type { ImportSource } from './types'

/** v1's export format (`git show origin/v1-archive:lib/obsidian/storage.ts`). */
type V1Manifest = {
  format: 'markdown-vault-zip'
  version: number
  customFolders?: string[]
  notes: { id: string; title: string; folder?: string; createdAt: string; updatedAt: string; path: string }[]
  media: { id: string; filename: string; mimeType: string; createdAt: string; path: string }[]
}

const V1_FORMAT = 'markdown-vault-zip'
const V1_VERSION = 3

function manifestOf(entries: FileEntry[]): V1Manifest | null {
  const text = entries.find((e) => e.path === 'manifest.json')?.text
  if (!text) return null
  try {
    const m = JSON.parse(text) as V1Manifest
    return m?.format === V1_FORMAT ? m : null
  } catch {
    return null
  }
}

export const isV1Zip = (entries: FileEntry[]) => manifestOf(entries) !== null

const time = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Date.now()
}

/**
 * A v1 backup ZIP → the shared import pipeline: each note at `folder/標題.md`, each media file under
 * `附件/`, and `![[id|名稱]]` / `![[檔名]]` rewritten to point at it. Everything else (same titles,
 * broken links, aliases, file blocks, the 100 MB limit) is the import's ordinary rules.
 */
export function v1ZipToSource(entries: FileEntry[]): ImportSource {
  const m = manifestOf(entries)
  if (!m) throw new Error('這不是 v1 的備份檔')
  if (m.version !== V1_VERSION) throw new Error('不支援此 v1 備份版本')
  const byPath = new Map(entries.map((e) => [e.path, e]))

  const out: FileEntry[] = []
  const mediaTarget = new Map<string, string>() // v1 id or file name → new path
  const taken = new Set<string>()
  for (const md of m.media ?? []) {
    const blob = byPath.get(md.path)?.blob
    if (!blob) continue
    const dot = md.filename.lastIndexOf('.')
    const ext = dot > 0 ? md.filename.slice(dot) : ''
    const path = uniqueName(`附件/${safeFileName(dot > 0 ? md.filename.slice(0, dot) : md.filename)}`, taken, ext) + ext
    taken.add(path.toLowerCase())
    out.push({ path, blob: blob.type ? blob : new Blob([blob], { type: md.mimeType }), mtime: time(md.createdAt) })
    mediaTarget.set(md.id, path)
    if (!mediaTarget.has(md.filename)) mediaTarget.set(md.filename, path)
  }

  const rewrite = (text: string) =>
    text.replace(/!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (raw, target: string, label?: string) => {
      const path = mediaTarget.get(target.trim())
      if (!path) return raw
      return `![[${path}${label && /^\d+(x\d+)?$/.test(label.trim()) ? '|' + label.trim() : ''}]]`
    })

  // Earlier notes keep their title when two share one (spec 4.5).
  const notes = [...(m.notes ?? [])].sort((a, b) => time(a.createdAt) - time(b.createdAt))
  const noteMeta = new Map<string, { title: string; createdAt: number; updatedAt: number }>()
  const notePaths = new Set<string>()
  for (const n of notes) {
    const text = byPath.get(n.path)?.text
    if (text === undefined) continue
    const folder = (n.folder ?? '').split('/').filter(Boolean)
    const path = noteFilePath(folder, n.title, notePaths)
    out.push({ path, text: rewrite(text), mtime: time(n.updatedAt) })
    noteMeta.set(path, { title: n.title, createdAt: time(n.createdAt), updatedAt: time(n.updatedAt) })
  }
  return { kind: 'v1', entries: out, noteMeta, emptyFolders: m.customFolders ?? [] }
}
