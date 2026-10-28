import { assignBlockIds } from '@/core/blocks'
import { newId } from '@/core/ids'
import { localDate } from '@/core/markdown/paths'
import type { PMNode } from '@/core/markdown/types'
import { dedupeTitle } from '@/core/vault/titles'
import { baseName, fileEntries, kindOf, makeResolver, mimeOf, titleOf, titleTaker, yieldTask, type BatchNote } from './import-shared'
import { resolveRefs } from './resolve'
import { IMPORT_JOB_KEY, type ImportChoices, type ImportDeps, type ImportPlan, type ImportReport, type ImportSource } from './types'

export const IMPORT_REPORT_KEY = 'importReport'
const NOTE_CHUNK = 25
const SAVE_EVERY = 25
/** An unfinished import older than this is not resumed (the vault has moved on). */
const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Progress of an import, kept in meta so a re-run with the same files continues where it stopped. */
export type Job = {
  jobId: string
  /** The choices it was started with: a re-run with other choices starts over. */
  choiceKey: string
  startedAt: number
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

const choiceKeyOf = (c: ImportChoices) => JSON.stringify([c.destination, c.onExisting, !!c.relocate, !!c.noBackupCopies])

/**
 * The unfinished run of this same import with these same choices, if it may continue: started within a
 * week and its destination folder still live. Anything else starts over.
 */
export async function resumableJob(plan: ImportPlan, choices: ImportChoices, deps: Pick<ImportDeps, 'db' | 'vault' | 'now'>): Promise<Job | undefined> {
  const saved = (await deps.db.meta.get(IMPORT_JOB_KEY))?.value as Job | undefined
  const now = (deps.now ?? Date.now)()
  const live = (id: string | null) => id === null || deps.vault.listFolders().some((f) => f.id === id)
  return saved && saved.jobId === plan.jobId && saved.choiceKey === choiceKeyOf(choices) && now - saved.startedAt < RESUME_WINDOW_MS && live(saved.rootFolderId)
    ? saved
    : undefined
}

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

  const choiceKey = choiceKeyOf(choices)
  const saved = await resumableJob(plan, choices, deps)
  const resumable = !!saved
  let job: Job
  if (saved) job = saved
  else {
    let rootFolderId: string | null
    if (choices.destination.kind === 'folder') rootFolderId = choices.destination.folderId
    else {
      const roots = new Set(vault.listFolders().filter((f) => f.parentId === null).map((f) => f.name))
      rootFolderId = vault.createFolder({ name: dedupeTitle(`匯入 ${localDate(now())}`, roots), parentId: null }).id
    }
    const copy = choices.onExisting === 'copy'
    const noteIds = Object.fromEntries(plan.notes.map((n) => [n.path, n.existing && copy ? newId() : n.noteId]))
    job = { jobId: plan.jobId, choiceKey, startedAt: now(), rootFolderId, folderIds: {}, noteIds, done: [], backups: {}, report: emptyReport(rootFolderId) }
  }
  const done = new Set(job.done)
  // Progress is recorded only after the vault's own changes are stored: a crash in between must make the
  // re-run redo the step, never skip it.
  const save = async () => {
    await vault.flushWrites()
    if (vault.hasFailedWrites()) throw new Error('無法儲存到這個瀏覽器（空間可能不足）')
    await db.meta.put({ key: IMPORT_JOB_KEY, value: { ...job, done: [...done] } })
  }
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
      const have = vault.getAttachment(a.attachmentId)
      if (have && !done.has(a.path)) {
        // Same id already here (re-import of a backup, or an interrupted run): make sure it is usable.
        if (have.deletedAt !== null) vault.restoreAttachment(a.attachmentId)
        if (!(await storage.getBlob(a.attachmentId))) await storage.putBlob(a.attachmentId, entry.blob!).catch(() => {})
      }
      if (!done.has(a.path) && !have) {
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
    if (done.size % SAVE_EVERY === 0) await save() // a re-run finds already stored attachments by id
  }
  await save()

  // Notes.
  const manifestNotes = new Map((src.manifest?.notes ?? []).map((n) => [n.path, n]))
  const batch: BatchNote[] = plan.notes.map((n) => ({
    path: n.path, title: titleOf(n.path, src, manifestNotes.get(n.path)), noteId: job.noteIds[n.path], doc: plan.parsed.get(n.path)!.doc,
  }))
  const resolver = makeResolver(batch, vault, attMap)
  const idMap = new Map(plan.notes.filter((n) => job.noteIds[n.path] !== n.noteId).map((n) => [n.noteId, job.noteIds[n.path]]))

  const resumed = resumable
  const titles = titleTaker(vault.listNotes().map((x) => x.title))
  for (const n of plan.notes) if (done.has(n.path)) step()
  const pending = plan.notes.filter((n) => !done.has(n.path))
  for (let i = 0; i < pending.length; i += NOTE_CHUNK) {
    // A chunk's new notes appear in one vault transaction (one sidebar / index update, not 25).
    const creates: (() => void)[] = []
    // Recorded only once the whole chunk is stored (the chunk's notes are created together below).
    const chunkDone: string[] = []
    const chunkReport: Pick<ImportReport, 'renamed' | 'unresolved' | 'aliased' | 'lossy'> = { renamed: [], unresolved: [], aliased: [], lossy: [] }
    for (const n of pending.slice(i, i + NOTE_CHUNK)) {
      const id = job.noteIds[n.path]
      const parsed = plan.parsed.get(n.path)!
      const original = titleOf(n.path, src, manifestNotes.get(n.path))
      let doc: PMNode
      if (plan.exact.has(n.path)) doc = idMap.size ? remapLinks(parsed.doc, idMap) : parsed.doc
      else {
        const r = resolveRefs(parsed.doc, resolver, n.path)
        doc = assignBlockIds(withTags(r.doc, parsed.tags))
        for (const raw of r.unresolved) chunkReport.unresolved.push({ noteId: id, raw })
        for (const raw of r.aliased) chunkReport.aliased.push({ noteId: id, raw })
        for (const syntax of parsed.lossy) chunkReport.lossy.push({ noteId: id, syntax })
      }

      const current = vault.getNote(id)
      if (current && !n.existing) {
        // Created by an earlier, interrupted run of this import.
      } else if (current) {
        // Overwrite: the current version goes to the trash first, as its own note.
        if (!job.backups[n.path] && !choices.noBackupCopies) {
          // Content first, then the note appears already in the trash (never a live, empty copy).
          const backupId = newId()
          await docs.write(backupId, await docs.read(id))
          vault.doc.transact(() => {
            vault.createNote({ id: backupId, title: titles.take(`${current.title}（覆蓋前）`), folderId: current.folderId })
            vault.trashNote(backupId)
          })
          job.backups[n.path] = backupId
          // The copy must be stored (and recorded) before the overwrite is: a crash in between must
          // never leave the old version with no note pointing at it.
          await vault.flushWrites()
          if (vault.hasFailedWrites()) throw new Error('無法儲存到這個瀏覽器（空間可能不足）')
          await db.meta.put({ key: IMPORT_JOB_KEY, value: { ...job, done: [...done] } })
        }
        await docs.replace(id, doc)
        if (current.deletedAt !== null) vault.restoreNote(id)
        if (choices.relocate) {
          const folderId = n.folderPath.length ? job.folderIds[n.folderPath.join('/')] : job.rootFolderId
          if (vault.getNote(id)!.folderId !== folderId) vault.moveNote(id, { folderId, index: Number.MAX_SAFE_INTEGER })
        }
        if (current.title !== original) {
          const taken = new Set(vault.listNotes().filter((x) => x.id !== id).map((x) => x.title))
          const title = dedupeTitle(original, taken)
          vault.renameNote(id, title)
          titles.reserve(title)
        }
      } else {
        const title = titles.take(original)
        if (title !== original.trim()) chunkReport.renamed.push({ from: original, to: title, noteId: id })
        const mn = manifestNotes.get(n.path)
        const meta = src.noteMeta?.get(n.path)
        const createdAt = mn?.createdAt ?? meta?.createdAt ?? parsed.created ?? undefined
        const updatedAt = mn?.updatedAt ?? meta?.updatedAt ?? parsed.updated ?? undefined
        // Content first: a crash before the note exists leaves stored content that the re-run reuses.
        // A backup's id may have content left by an earlier crashed run: never add a second copy on top.
        if (resumed) {
          // Content stored by this same run before the crash is this same document: reuse it.
          if ((await storage.loadDoc(id)).length === 0) await docs.write(id, doc)
        } else {
          // A fresh run: content under a backup's id can only be left from some other crashed run.
          if (manifestNotes.has(n.path) && (await storage.loadDoc(id)).length) await storage.deleteDoc(id)
          await docs.write(id, doc)
        }
        const folderId = n.folderPath.length ? job.folderIds[n.folderPath.join('/')] : job.rootFolderId
        creates.push(() => {
          try {
            vault.createNote({ id, title, folderId, createdAt, updatedAt })
          } catch {
            // The title was taken meanwhile (e.g. by a restored note): fall back to a free one.
            const taken = new Set(vault.listNotes().map((x) => x.title))
            vault.createNote({ id, title: dedupeTitle(title, taken), folderId, createdAt, updatedAt })
          }
        })
      }
      chunkDone.push(n.path)
    }
    vault.doc.transact(() => creates.forEach((f) => f()))
    for (const p of chunkDone) {
      done.add(p)
      step()
    }
    job.report.notes += chunkDone.length
    for (const k of ['renamed', 'unresolved', 'aliased', 'lossy'] as const) (job.report[k] as unknown[]).push(...chunkReport[k])
    await save()
    await yieldTask()
  }

  await vault.flushWrites()
  await db.meta.delete(IMPORT_JOB_KEY)
  await db.meta.put({ key: IMPORT_REPORT_KEY, value: { at: now(), report: job.report } })
  return job.report
}
