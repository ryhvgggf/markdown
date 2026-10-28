import type { NotesDb } from '@/adapters/storage/db'
import type { Dir } from '@/adapters/fs/types'
import type { StorageAdapter } from '@/adapters/storage/types'
import { hashText, localStamp, safeFileName, uniqueName } from '@/core/markdown/paths'
import type { PMNode } from '@/core/markdown/types'
import { ATTACHMENT_DIR } from '@/core/transfer/export'
import { blockIdsOf } from '@/core/transfer/import-shared'
import type { TransferClient } from '@/core/transfer/transfer-client'
import { MANIFEST_PATH, type DocIO, type V2Manifest } from '@/core/transfer/types'
import type { Vault } from '@/core/vault/vault'
import { desiredPaths } from './mirror-paths'
import { emptyState, loadState, saveState, type MirrorState, type MirrorStatus } from './mirror-state'

export type LockLike = { request(name: string, cb: () => Promise<void>): Promise<unknown> }

export type MirrorDeps = {
  vault: Vault
  db: NotesDb
  storage: StorageAdapter
  docs: DocIO
  client: Pick<TransferClient, 'serialize'>
  onIndexed(cb: (noteId: string) => void): () => void
  isTyping(): boolean
  idle(): Promise<void>
  sleep?(ms: number): Promise<void>
  locks?: LockLike
  now?(): number
}

export const MIRROR_LOCK = 'notes-v2-mirror'
export const RETRY_MS = [2000, 5000, 15000]
const MANIFEST_EVERY_MS = 10_000
const TYPING_POLL_MS = 400

const walk = (n: PMNode, fn: (n: PMNode) => void): void => (fn(n), n.content?.forEach((c) => walk(c, fn)))
const errName = (e: unknown) => (e as { name?: string })?.name ?? ''

/**
 * One-way copy of the vault into a folder as `.md` files (spec 8). Writes happen after a note is
 * indexed, in idle time and never while typing; a file edited outside the app is kept under another
 * name, never overwritten or deleted. Only the tab holding the Web Lock writes.
 */
export class Mirror {
  status: MirrorStatus = 'off'
  private dir: Dir | null = null
  private state: MirrorState = emptyState()
  private readonly queue = new Set<string>()
  private draining: Promise<void> | null = null
  private readonly tries = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private stops: (() => void)[] = []
  private releaseLock: (() => void) | null = null
  private manifestAt = 0
  /** Bumped by start / stop: work begun for an older folder must not save its records. */
  private gen = 0
  private manifestTimer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: MirrorDeps) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  get snapshot(): Readonly<MirrorState> {
    return this.state
  }
  private setStatus(s: MirrorStatus) {
    this.status = s
    for (const cb of this.listeners) cb()
  }

  /** Starts writing into `dir` once this tab holds the lock (other tabs wait their turn). */
  async start(dir: Dir): Promise<void> {
    await this.stop()
    const gen = ++this.gen
    this.dir = dir
    this.setStatus('waiting')
    const begin = async () => {
      if (this.gen !== gen) return
      // Read the records only now: while this tab waited, another one may have written files.
      this.state = await loadState(this.deps.db)
      if (this.gen !== gen) return
      this.setStatus('active')
      this.stops.push(this.deps.onIndexed((id) => this.enqueue([id])))
      this.stops.push(this.deps.vault.observe(() => this.enqueue(this.moved())))
      await this.reconcile()
    }
    if (!this.deps.locks) return begin()
    void this.deps.locks.request(MIRROR_LOCK, async () => {
      await begin()
      await new Promise<void>((r) => (this.releaseLock = r))
    })
  }

  /** Stops writing; resolves once a write in progress has finished. */
  stop(): Promise<void> {
    this.gen++
    this.stops.splice(0).forEach((f) => f())
    this.releaseLock?.()
    this.releaseLock = null
    if (this.manifestTimer) clearTimeout(this.manifestTimer)
    this.manifestTimer = null
    this.queue.clear()
    this.dir = null
    if (this.status !== 'off') this.setStatus('off')
    return this.whenIdle()
  }

  /** Every note checked once (startup, after a pause): new, changed, moved or removed files. */
  async reconcile(): Promise<void> {
    this.enqueue([...this.deps.vault.listNotes({ includeTrashed: true }).map((n) => n.id), ...Object.keys(this.state.files)])
    await this.whenIdle()
  }

  /** Resolves once the queue is empty (tests, and the UI's "已同步"). */
  async whenIdle(): Promise<void> {
    while (this.draining) await this.draining
  }

  private moved(): string[] {
    const want = desiredPaths(this.deps.vault)
    const ids = new Set<string>()
    for (const [id, w] of want) if (this.state.files[id]?.path !== w.path) ids.add(id)
    for (const id of Object.keys(this.state.files)) if (!want.has(id)) ids.add(id)
    return [...ids]
  }

  private enqueue(ids: string[]) {
    if (this.status !== 'active') return
    for (const id of ids) this.queue.add(id)
    this.kick()
  }

  /** One drain at a time; an id queued while the last one was finishing starts the next. */
  private kick() {
    if (this.draining) return
    this.draining = this.drain().finally(() => {
      this.draining = null
      if (this.queue.size && this.status === 'active') this.kick()
    })
  }

  private async untilNotTyping(): Promise<void> {
    while (this.deps.isTyping()) await this.sleep(TYPING_POLL_MS)
  }

  /** The folder, with every file operation held back while keys are still coming in. */
  private gated(dir: Dir): Dir {
    const wait = () => this.untilNotTyping()
    return {
      stat: async (p) => (await wait(), dir.stat(p)),
      read: async (p) => (await wait(), dir.read(p)),
      write: async (p, d) => (await wait(), dir.write(p, d)),
      remove: async (p) => (await wait(), dir.remove(p)),
      list: () => dir.list(),
    }
  }

  private async drain(): Promise<void> {
    const gen = this.gen
    while (this.queue.size && this.status === 'active' && gen === this.gen) {
      await this.untilNotTyping()
      await this.deps.idle()
      const id = this.queue.values().next().value as string
      this.queue.delete(id)
      try {
        await this.syncNote(id, this.gated(this.dir!))
        if (gen !== this.gen) return
        this.tries.delete(id)
        delete this.state.failed[id]
      } catch (e) {
        if (errName(e) === 'NotFoundError' && !(await this.rootExists())) return this.pause('missing-folder')
        if (errName(e) === 'NotAllowedError' || errName(e) === 'SecurityError') return this.pause('paused-permission')
        const n = (this.tries.get(id) ?? 0) + 1
        this.tries.set(id, n)
        if (n <= RETRY_MS.length) {
          void this.sleep(RETRY_MS[n - 1]).then(() => this.enqueue([id]))
        } else {
          this.state.failed[id] = e instanceof Error ? e.message : String(e)
          this.tries.delete(id)
        }
      }
      if (gen !== this.gen) return
      await saveState(this.deps.db, this.state)
      this.scheduleManifest()
    }
  }

  private async rootExists(): Promise<boolean> {
    try {
      if (!this.dir) return true
      for await (const f of this.dir.list()) return !!f
      return true
    } catch {
      return false
    }
  }

  private pause(s: MirrorStatus) {
    this.queue.clear()
    this.setStatus(s)
  }

  /** Resume after the user granted access again or picked the folder again. */
  async resume(dir?: Dir): Promise<void> {
    if (dir) this.dir = dir
    if (!this.dir) return
    this.setStatus('active')
    await this.reconcile()
  }

  // ---- one note ----

  private async syncNote(id: string, dir: Dir): Promise<void> {
    const want = desiredPaths(this.deps.vault).get(id)
    const rec = this.state.files[id]
    if (!want) {
      // Deleted for good: its file goes too (unless edited outside the app).
      if (rec && (await this.unchanged(dir, rec.path, rec))) await dir.remove(rec.path)
      delete this.state.files[id]
      return
    }
    const doc = await this.deps.docs.read(id)
    const text = await this.serialize(id, doc, dir)
    const hash = hashText(text)
    if (rec && rec.path === want.path && rec.hash === hash) {
      // Up to date — unless the file was deleted or edited in the folder since.
      const st = await dir.stat(rec.path)
      if (st && st.mtime === rec.mtime && st.size === rec.size) return
    }

    if (!(await this.unchanged(dir, want.path, rec?.path === want.path ? rec : null))) await this.keepOutsideEdit(dir, id, want.path)
    const st = await dir.write(want.path, text)
    if (rec && rec.path !== want.path) {
      if (await this.unchanged(dir, rec.path, rec)) await dir.remove(rec.path)
    }
    this.state.files[id] = { path: want.path, hash, mtime: st.mtime, size: st.size, trashed: want.trashed, blockIds: blockIdsOf(doc) }
    this.state.lastWriteAt = this.now()
  }

  /** True when the file is missing, or is exactly what the app last wrote there. */
  private async unchanged(dir: Dir, path: string, rec: { mtime: number; size: number } | null): Promise<boolean> {
    const st = await dir.stat(path)
    if (!st) return true
    return !!rec && st.mtime === rec.mtime && st.size === rec.size
  }

  private async keepOutsideEdit(dir: Dir, noteId: string, path: string): Promise<void> {
    const file = await dir.read(path)
    if (!file) return
    const base = `${path.replace(/\.md$/i, '')} (外部修改 ${localStamp(this.now())})`
    let keptAs = `${base}.md`
    for (let n = 2; await dir.stat(keptAs); n++) keptAs = `${base} (${n}).md` // never over an earlier kept copy
    await dir.write(keptAs, file.data)
    this.state.conflicts.push({ noteId, keptAs, at: this.now() })
  }

  private async serialize(noteId: string, doc: PMNode, dir: Dir): Promise<string> {
    const { vault, db } = this.deps
    const headings: Record<string, string> = {}
    const attachments: Record<string, string> = {}
    const targets: [string, string][] = []
    const media: string[] = []
    walk(doc, (n) => {
      if (n.type === 'noteLink' && n.attrs?.blockId) targets.push([n.attrs.noteId as string, n.attrs.blockId as string])
      if (n.type === 'media') media.push(n.attrs?.attachmentId as string)
    })
    const rows = targets.length ? await db.blocks.bulkGet(targets) : []
    rows.forEach((r, i) => r?.type === 'heading' && (headings[`${targets[i][0]}#${targets[i][1]}`] = r.text))
    // Blocks of this note that other notes link to (headings are linked by their text instead).
    const own = new Map<string, PMNode>()
    walk(doc, (n) => typeof n.attrs?.id === 'string' && own.set(n.attrs.id, n))
    const anchored = new Set<string>()
    for (const l of await db.links.where('targetNoteId').equals(noteId).toArray()) {
      const b = l.targetBlockId ? own.get(l.targetBlockId) : undefined
      if (b && b.type !== 'heading') anchored.add(l.targetBlockId!)
    }
    for (const id of media) {
      const p = await this.ensureAttachment(id, dir)
      if (p) attachments[id] = p
    }
    const titles = Object.fromEntries(vault.listNotes({ includeTrashed: true }).map((n) => [n.id, n.title]))
    const [text] = await this.deps.client.serialize([{ doc, anchored: [...anchored] }], { titles, headings, attachments })
    return text
  }

  private async ensureAttachment(id: string, dir: Dir): Promise<string | null> {
    const a = this.deps.vault.getAttachment(id)
    if (!a || a.deletedAt !== null) return null
    const rec = this.state.attachments[id]
    if (rec && (await dir.stat(rec.path))) return rec.path
    const blob = await this.deps.storage.getBlob(id)
    if (!blob) return null
    const taken = new Set(Object.values(this.state.attachments).map((x) => x.path.toLowerCase()))
    const dot = a.filename.lastIndexOf('.')
    const ext = dot > 0 ? a.filename.slice(dot) : ''
    const stem = `${ATTACHMENT_DIR}/${safeFileName(dot > 0 ? a.filename.slice(0, dot) : a.filename)}`
    let path = rec?.path ?? ''
    // A new name never lands on a file already in the folder (the user's own, or another attachment's).
    while (!path || (!rec && (await dir.stat(path)))) {
      if (path) taken.add(path.toLowerCase())
      path = uniqueName(stem, taken, ext) + ext
    }
    const st = await dir.write(path, blob)
    this.state.attachments[id] = { path, ...st }
    return path
  }

  // ---- manifest ----

  private scheduleManifest() {
    if (this.manifestTimer || this.status !== 'active') return
    const wait = Math.max(0, this.manifestAt + MANIFEST_EVERY_MS - this.now())
    this.manifestTimer = setTimeout(() => {
      this.manifestTimer = null
      void this.writeManifest().catch(() => {})
    }, wait)
  }

  /** `.notes-v2.json` without documents: ids, folders and block ids, for a restore from this folder. */
  async writeManifest(): Promise<void> {
    if (!this.dir) return
    this.manifestAt = this.now()
    const { vault } = this.deps
    const folders = vault.listFolders()
    const byId = new Map(folders.map((f) => [f.id, f]))
    const chain = (id: string | null) => {
      const out: string[] = []
      for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) out.unshift(f.name)
      return out.join('/')
    }
    const manifest: V2Manifest = {
      format: 'notes-v2', version: 1, exportedAt: this.now(),
      folders: folders.map((f, i) => ({ id: f.id, path: chain(f.id), order: i })),
      notes: vault.listNotes().flatMap((n) => {
        const r = this.state.files[n.id]
        return r && !r.trashed ? [{ id: n.id, path: r.path, title: n.title, createdAt: n.createdAt, updatedAt: n.updatedAt, mdHash: r.hash, blockIds: r.blockIds }] : []
      }),
      attachments: Object.entries(this.state.attachments).flatMap(([id, r]) => {
        const a = vault.getAttachment(id)
        return a ? [{ id, path: r.path, filename: a.filename, mimeType: a.mimeType, createdAt: a.createdAt }] : []
      }),
    }
    await this.gated(this.dir).write(MANIFEST_PATH, JSON.stringify(manifest))
  }
}
