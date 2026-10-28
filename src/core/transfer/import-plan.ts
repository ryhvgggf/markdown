import { MAX_ATTACHMENT_BYTES } from '@/core/attachments'
import { newId } from '@/core/ids'
import { hashText } from '@/core/markdown/paths'
import type { ParseResult } from '@/core/markdown/types'
import { dedupeTitle, normalizeTitle } from '@/core/vault/titles'
import {
  applyBlockIds, dirParts, fileEntries, kindOf, makeResolver, mimeOf, noteEntries, titleOf, type BatchNote,
} from './import-shared'
import { resolveRefs } from './resolve'
import type { ImportDeps, ImportPlan, ImportSource, PlannedNote } from './types'

const PARSE_BATCH = 50

/** Reads and parses the source; writes nothing. The result is the preview and the input of applyImport. */
export async function planImport(src: ImportSource, deps: ImportDeps): Promise<ImportPlan> {
  const { vault } = deps
  const notes = noteEntries(src)
  const files = fileEntries(src)
  const manifestNotes = new Map((src.manifest?.notes ?? []).map((n) => [n.path, n]))
  const manifestFiles = new Map((src.manifest?.attachments ?? []).map((a) => [a.path, a]))

  // Documents: verbatim from the manifest when the file is unchanged, otherwise parsed.
  const parsed = new Map<string, ParseResult>()
  const exact = new Set<string>()
  const toParse: { path: string; text: string; dialect?: 'v1' }[] = []
  for (const e of notes) {
    const mn = manifestNotes.get(e.path)
    if (mn?.doc && mn.mdHash === hashText(e.text!)) {
      parsed.set(e.path, { doc: mn.doc, tags: [], created: null, updated: null, lossy: [] })
      exact.add(e.path)
    } else toParse.push({ path: e.path, text: e.text!, ...(src.kind === 'v1' && { dialect: 'v1' as const }) })
  }
  for (let i = 0; i < toParse.length; i += PARSE_BATCH) {
    const batch = toParse.slice(i, i + PARSE_BATCH)
    const results = await deps.parse(batch)
    batch.forEach((f, k) => {
      const mn = manifestNotes.get(f.path)
      const r = results[k]
      parsed.set(f.path, mn && mn.mdHash === hashText(f.text) ? { ...r, doc: applyBlockIds(r.doc, mn.blockIds) } : r)
    })
  }

  // Notes and titles (renames estimated as if existing notes were copied).
  const taken = new Set(vault.listNotes().map((n) => n.title))
  let existingCount = 0
  const planned: PlannedNote[] = notes.map((e) => {
    const mn = manifestNotes.get(e.path)
    const original = titleOf(e.path, src, mn)
    const existing = !!mn && vault.getNote(mn.id) !== undefined
    if (existing) existingCount++
    const title = dedupeTitle(original, taken)
    taken.add(title)
    return {
      path: e.path,
      noteId: mn?.id ?? newId(),
      title,
      folderPath: dirParts(e.path),
      ...(normalizeTitle(title) !== normalizeTitle(original) && { renamedFrom: original }),
      ...(existing && { existing: true }),
    }
  })

  const folderKeys = new Set<string>()
  for (const n of planned) for (let d = 1; d <= n.folderPath.length; d++) folderKeys.add(n.folderPath.slice(0, d).join('/'))
  for (const f of [...(src.emptyFolders ?? []), ...(src.manifest?.folders.map((f) => f.path) ?? [])]) {
    const parts = f.split('/').filter(Boolean)
    for (let d = 1; d <= parts.length; d++) folderKeys.add(parts.slice(0, d).join('/'))
  }
  const folders = [...folderKeys].map((k) => k.split('/')).sort((a, b) => a.length - b.length || a.join('/').localeCompare(b.join('/')))

  const attachments = files.map((e) => ({
    path: e.path,
    attachmentId: manifestFiles.get(e.path)?.id ?? newId(),
    size: e.blob!.size,
    ...(e.blob!.size > MAX_ATTACHMENT_BYTES && { skipped: 'too-large' as const }),
  }))

  // Preview of links that will not resolve.
  const batch: BatchNote[] = planned.map((n) => ({ path: n.path, title: titleOf(n.path, src, manifestNotes.get(n.path)), noteId: n.noteId, doc: parsed.get(n.path)!.doc }))
  const attMap = new Map(
    attachments.filter((a) => !a.skipped).map((a) => {
      const entry = files.find((f) => f.path === a.path)!
      return [a.path, { id: a.attachmentId, kind: kindOf(a.path, mimeOf(entry)) }] as const
    }),
  )
  const resolver = makeResolver(batch, vault, attMap)
  const unresolved: ImportPlan['unresolved'] = []
  const aliased: ImportPlan['aliased'] = []
  for (const n of planned) {
    if (exact.has(n.path)) continue
    const r = resolveRefs(parsed.get(n.path)!.doc, resolver, n.path)
    for (const raw of r.unresolved) unresolved.push({ notePath: n.path, raw })
    for (const raw of r.aliased) aliased.push({ notePath: n.path, raw })
  }

  const jobId = hashText(
    [...notes.map((e) => e.path + ':' + hashText(e.text!)), ...files.map((e) => e.path + ':' + e.blob!.size)].sort().join('\n'),
  )
  return { jobId, notes: planned, folders, attachments, unresolved, aliased, existingCount, parsed, exact }
}
