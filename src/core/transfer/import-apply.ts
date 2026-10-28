import { assignBlockIds } from '@/core/blocks'
import { newId } from '@/core/ids'
import { localDate } from '@/core/markdown/paths'
import type { PMNode } from '@/core/markdown/types'
import { dedupeTitle } from '@/core/vault/titles'
import { baseName, fileEntries, kindOf, makeResolver, mimeOf, titleOf, type BatchNote } from './import-shared'
import { resolveRefs } from './resolve'
import { IMPORT_JOB_KEY, type ImportChoices, type ImportDeps, type ImportPlan, type ImportReport, type ImportSource } from './types'

export const IMPORT_REPORT_KEY = 'importReport'

/** Progress of an import, kept in meta so a re-run with the same files continues where it stopped. */
type Job = {
  jobId: string
  rootFolderId: string | null
  folderIds: Record<string, string>
  noteIds: Record<string, string>
  done: string[]
  backups: Record<string, string>
  report: ImportReport
}

const emptyReport = (folderId: string | null): ImportReport => ({
  notes: 0, folders: 0, attachments: 0, renamed: [], unresolved: [], aliased: [], lossy: [], skipped: [], folderId,
})

/** Replaces note ids in links (copies of existing notes get new ids; their links follow). */
function remapLinks(doc: PMNode, ids: Map<string, string>): PMNode {
  if (doc.type === 'noteLink') {
    const to = ids.get(doc.attrs?.noteId as string)
    return to ? { ...doc, attrs: { ...doc.attrs, noteId: to } } : doc
  }
  return doc.content ? { ...doc, content: doc.content.map((c) => remapLinks(c, ids)) } : doc
}

const withTags = (doc: PMNode, tags: string[]): PMNode => {
  if (!tags.length) return doc
  const line = tags.flatMap((name, i) => [...(i ? [{ type: 'text', text: ' ' }] : []), { type: 'tag', attrs: { name } }])
  return { ...doc, content: [...(doc.content ?? []), { type: 'paragraph', content: line }] }
}

/**
 * Writes the plan: folders, then attachments (one blob at a time), then each note created with its
 * full content. Resumable: progress is saved after every item under meta.importJob.
 */
export async function applyImport(
  plan: ImportPlan,
  src: ImportSource,
  choices: ImportChoices,
  deps: ImportDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const { vault, storage, db, docs } = deps
  const now = deps.now ?? Date.now
  if (plan.existingCount > 0 && !choices.onExisting) throw new Error('請選擇要覆蓋還是建立副本')

  const saved = (await db.meta.get(IMPORT_JOB_KEY))?.value as Job | undefined
  let job: Job
  if (saved?.jobId === plan.jobId) job = saved
  else {
    let rootFolderId: string | null
    if (choices.destination.kind === 'folder') rootFolderId = choices.destination.folderId
    else {
      const roots = new Set(vault.listFolders().filter((f) => f.parentId === null).map((f) => f.name))
      rootFolderId = vault.createFolder({ name: dedupeTitle(`匯入 ${localDate(now())}`, roots), parentId: null }).id
    }
    const copy = choices.onExisting === 'copy'
    const noteIds = Object.fromEntries(plan.notes.map((n) => [n.path, n.existing && copy ? newId() : n.noteId]))
    job = { jobId: plan.jobId, rootFolderId, folderIds: {}, noteIds, done: [], backups: {}, report: emptyReport(rootFolderId) }
  }
  const done = new Set(job.done)
  const save = () => db.meta.put({ key: IMPORT_JOB_KEY, value: { ...job, done: [...done] } })
  const total = plan.attachments.length + plan.notes.length
  let progress = 0
  const step = () => onProgress?.(++progress, total)
  await save()

  // Folders.
  for (const parts of plan.folders) {
    const key = parts.join('/')
    if (job.folderIds[key] && vault.listFolders().some((f) => f.id === job.folderIds[key])) continue
    const parentId = parts.length > 1 ? job.folderIds[parts.slice(0, -1).join('/')] : job.rootFolderId
    const wanted = src.manifest?.folders.find((f) => f.path === key)?.id
    const id = wanted && !vault.listFolders({ includeTrashed: true }).some((f) => f.id === wanted) ? wanted : undefined
    job.folderIds[key] = vault.createFolder({ id, name: parts[parts.length - 1], parentId }).id
    job.report.folders++
  }
  await save()

  // Attachments.
  const files = new Map(fileEntries(src).map((e) => [e.path, e]))
  const manifestFiles = new Map((src.manifest?.attachments ?? []).map((a) => [a.path, a]))
  const attMap = new Map<string, { id: string; kind: ReturnType<typeof kindOf> }>()
  for (const a of plan.attachments) {
    const entry = files.get(a.path)!
    const mime = manifestFiles.get(a.path)?.mimeType ?? mimeOf(entry)
    if (a.skipped) {
      if (!done.has(a.path)) job.report.skipped.push({ path: a.path, reason: '檔案超過 100 MB' })
    } else {
      if (!done.has(a.path) && !vault.getAttachment(a.attachmentId)) {
        const filename = manifestFiles.get(a.path)?.filename ?? baseName(a.path)
        vault.addAttachment({ id: a.attachmentId, filename, mimeType: mime, size: a.size, createdAt: manifestFiles.get(a.path)?.createdAt })
        try {
          await storage.putBlob(a.attachmentId, entry.blob!)
          job.report.attachments++
        } catch {
          vault.removeAttachment(a.attachmentId)
          job.report.skipped.push({ path: a.path, reason: '無法儲存' })
        }
      }
      if (vault.getAttachment(a.attachmentId)) attMap.set(a.path, { id: a.attachmentId, kind: kindOf(a.path, mime) })
    }
    done.add(a.path)
    step()
    await save()
  }

  // Notes.
  const manifestNotes = new Map((src.manifest?.notes ?? []).map((n) => [n.path, n]))
  const batch: BatchNote[] = plan.notes.map((n) => ({
    path: n.path, title: titleOf(n.path, src, manifestNotes.get(n.path)), noteId: job.noteIds[n.path], doc: plan.parsed.get(n.path)!.doc,
  }))
  const resolver = makeResolver(batch, vault, attMap)
  const idMap = new Map(plan.notes.filter((n) => job.noteIds[n.path] !== n.noteId).map((n) => [n.noteId, job.noteIds[n.path]]))

  for (const n of plan.notes) {
    if (done.has(n.path)) {
      step()
      continue
    }
    const id = job.noteIds[n.path]
    const parsed = plan.parsed.get(n.path)!
    const original = titleOf(n.path, src, manifestNotes.get(n.path))
    let doc: PMNode
    if (plan.exact.has(n.path)) doc = idMap.size ? remapLinks(parsed.doc, idMap) : parsed.doc
    else {
      const r = resolveRefs(parsed.doc, resolver, n.path)
      doc = assignBlockIds(withTags(r.doc, parsed.tags))
      for (const raw of r.unresolved) job.report.unresolved.push({ noteId: id, raw })
      for (const raw of r.aliased) job.report.aliased.push({ noteId: id, raw })
      for (const syntax of parsed.lossy) job.report.lossy.push({ noteId: id, syntax })
    }

    const current = vault.getNote(id)
    if (current && !n.existing) {
      // Created by an earlier, interrupted run of this import.
    } else if (current) {
      // Overwrite: the current version goes to the trash first, as its own note.
      if (!job.backups[n.path] && !choices.noBackupCopies) {
        const before = await docs.read(id)
        const taken = new Set(vault.listNotes().map((x) => x.title))
        const backup = vault.createNote({ title: dedupeTitle(`${current.title}（覆蓋前）`, taken), folderId: current.folderId })
        await docs.write(backup.id, before)
        vault.trashNote(backup.id)
        job.backups[n.path] = backup.id
        await save()
      }
      await docs.replace(id, doc)
      if (current.deletedAt !== null) vault.restoreNote(id)
      if (choices.relocate) {
        const folderId = n.folderPath.length ? job.folderIds[n.folderPath.join('/')] : job.rootFolderId
        if (vault.getNote(id)!.folderId !== folderId) vault.moveNote(id, { folderId, index: Number.MAX_SAFE_INTEGER })
      }
      if (current.title !== original) {
        const taken = new Set(vault.listNotes().filter((x) => x.id !== id).map((x) => x.title))
        vault.renameNote(id, dedupeTitle(original, taken))
      }
    } else {
      const taken = new Set(vault.listNotes().map((x) => x.title))
      const title = dedupeTitle(original, taken)
      if (title !== original.trim()) job.report.renamed.push({ from: original, to: title, noteId: id })
      const mn = manifestNotes.get(n.path)
      const meta = src.noteMeta?.get(n.path)
      const createdAt = mn?.createdAt ?? meta?.createdAt ?? parsed.created ?? undefined
      const updatedAt = mn?.updatedAt ?? meta?.updatedAt ?? parsed.updated ?? undefined
      // Content first: a crash before the note exists leaves stored content that the re-run reuses.
      if ((await storage.loadDoc(id)).length === 0) await docs.write(id, doc)
      const folderId = n.folderPath.length ? job.folderIds[n.folderPath.join('/')] : job.rootFolderId
      vault.createNote({ id, title, folderId, createdAt, updatedAt })
    }
    job.report.notes++
    done.add(n.path)
    step()
    await save()
  }

  await vault.flushWrites()
  await db.meta.delete(IMPORT_JOB_KEY)
  await db.meta.put({ key: IMPORT_REPORT_KEY, value: { at: now(), report: job.report } })
  return job.report
}
