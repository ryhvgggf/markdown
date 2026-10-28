import { normalizeZipPath } from '@/core/markdown/paths'
import type { FileEntry } from '@/core/markdown/types'
import { MANIFEST_PATH, type ImportSource, type V2Manifest } from './types'

function readManifest(text: string | undefined): V2Manifest | undefined {
  if (!text) return undefined
  try {
    const m = JSON.parse(text) as V2Manifest
    return m?.format === 'notes-v2' && m.version === 1 && Array.isArray(m.notes) ? m : undefined
  } catch {
    return undefined
  }
}

/**
 * Files picked by the user (a ZIP's contents, a folder, loose .md files) → an import source. Paths are
 * normalized; junk and anything under `.垃圾桶/` (a mirror folder's trash) is dropped. A v2 backup that
 * was re-zipped inside one top folder is unwrapped so its manifest paths match.
 */
export function sourceFromEntries(raw: FileEntry[]): ImportSource {
  let entries = raw.flatMap((e) => {
    const path = normalizeZipPath(e.path)
    return path && !path.startsWith('.垃圾桶/') ? [{ ...e, path }] : []
  })
  const at = (es: FileEntry[]) => readManifest(es.find((e) => e.path === MANIFEST_PATH)?.text)
  if (!at(entries)) {
    const nested = entries.find((e) => e.path.endsWith('/' + MANIFEST_PATH) && e.path.split('/').length === 2)
    const top = nested?.path.split('/')[0] + '/'
    if (nested && entries.every((e) => e.path.startsWith(top))) entries = entries.map((e) => ({ ...e, path: e.path.slice(top.length) }))
  }
  const manifest = at(entries)
  return manifest ? { kind: 'v2', entries, manifest } : { kind: 'markdown', entries }
}
