import { MAX_EXPIRY_SECONDS, MAX_SHARE_FILE_BYTES, MAX_SHARE_NOTES, ORPHAN_FOLDER_GRACE_MS, SHARE_FILE_OVERHEAD, ShareError } from './types'
import type { GuardedWrite, NewShare, NewSharePassword, ProtectedOpen, PublicShare, ShareAdapter, ShareRecord } from './types'

/** One stored link, as the server keeps it (the verifier is SHA-256 of the proof, never the proof). */
export type MemoryShareRow = ShareRecord & { userId: string; ciphertext: Uint8Array; verifier: Uint8Array | null }

/** What the database's `share_links_note_ids` check accepts (migration 0007). */
const validNoteIds = (ids: string[], first: string) =>
  ids.length >= 1 && ids.length <= MAX_SHARE_NOTES && ids[0] === first && new Set(ids).size === ids.length && ids.every((n) => typeof n === 'string' && n.length > 0 && n.length <= 64)

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const recordOf = ({ id, vaultId, noteId, noteIds, wrappedKey, createdAt, updatedAt, expiresAt, password }: MemoryShareRow): ShareRecord => ({
  id,
  vaultId,
  noteId,
  noteIds: noteIds ? [...noteIds] : null,
  wrappedKey,
  createdAt,
  updatedAt,
  expiresAt,
  password: password && { ...password },
})

/**
 * In-memory `ShareAdapter` for tests and e2e (one account; `now` is injectable and plays the server clock).
 * Mirrors what migrations 0005–0007 do on the server: expiry and password checks happen here, not in the caller.
 * `persist` lets the e2e backend keep the rows in localStorage (loaded before and saved after each call).
 */
export class MemoryShare implements ShareAdapter {
  rows = new Map<string, MemoryShareRow>()
  /** Share-file folders (migration 0008): owner and creation time; they outlive their link. */
  folders = new Map<string, { userId: string; createdAt: number }>()
  /** Stored files by `<shareId>/<objectName>`. */
  files = new Map<string, Uint8Array>()
  /** The signed-in account, for the folder ownership the server checks (tests can switch it). */
  userId = 'u1'
  constructor(
    private now: () => number = Date.now,
    private persist?: { load(): Map<string, MemoryShareRow>; save(rows: Map<string, MemoryShareRow>): void },
  ) {}

  private async tx<T>(fn: (rows: Map<string, MemoryShareRow>) => T | Promise<T>): Promise<T> {
    if (this.persist) this.rows = this.persist.load()
    const out = await fn(this.rows)
    this.persist?.save(this.rows)
    return out
  }
  private expired = (r: MemoryShareRow) => r.expiresAt !== null && r.expiresAt <= this.now()
  private async guard(r: MemoryShareRow | undefined, expectedSalt: string | null, expectedHash?: Uint8Array): Promise<GuardedWrite> {
    if (!r) return 'not-found'
    if ((r.password?.saltB64 ?? null) !== expectedSalt) return 'changed'
    if (expectedHash && !same(await sha256(r.ciphertext), expectedHash)) return 'changed'
    return 'ok'
  }

  create(s: NewShare): Promise<void> {
    return this.tx((rows) => {
      if (rows.has(s.id)) throw new ShareError('unknown', 'duplicate share id')
      if (s.noteIds && !validNoteIds(s.noteIds, s.noteId)) throw new ShareError('unknown', 'bad note list')
      const t = this.now()
      const noteIds = s.noteIds ? [...s.noteIds] : null
      rows.set(s.id, { ...s, noteIds, ciphertext: s.ciphertext.slice(), createdAt: t, updatedAt: t, expiresAt: null, password: null, verifier: null })
    })
  }
  update(id: string, ciphertext: Uint8Array, expectedSalt: string | null, expectedHash?: Uint8Array): Promise<GuardedWrite> {
    return this.tx(async (rows) => {
      const r = rows.get(id)
      // Multi-note links change their snapshot only together with their notes (migration 0007).
      const g = r?.noteIds ? 'changed' : await this.guard(r, expectedSalt, expectedHash)
      if (g === 'ok') Object.assign(r!, { ciphertext: ciphertext.slice(), updatedAt: this.now() })
      return g
    })
  }
  remove(id: string): Promise<void> {
    return this.tx((rows) => void rows.delete(id))
  }
  setNotes(id: string, noteIds: string[], ciphertext: Uint8Array, expectedSalt: string | null, expectedHash: Uint8Array): Promise<GuardedWrite> {
    return this.tx(async (rows) => {
      const r = rows.get(id)
      if (!r?.noteIds) return 'not-found'
      const g = await this.guard(r, expectedSalt, expectedHash)
      if (g !== 'ok') return g
      if (!validNoteIds(noteIds, noteIds[0])) throw new ShareError('unknown', 'bad note list')
      Object.assign(r, { noteId: noteIds[0], noteIds: [...noteIds], ciphertext: ciphertext.slice(), updatedAt: this.now() })
      return g
    })
  }
  removeForNotes(vaultId: string, noteIds: string[]): Promise<void> {
    const ids = new Set(noteIds)
    return this.tx((rows) => {
      for (const [id, r] of rows) if (r.vaultId === vaultId && (ids.has(r.noteId) || r.noteIds?.some((n) => ids.has(n)))) rows.delete(id)
    })
  }
  listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]> {
    return this.list((r) => r.vaultId === vaultId && r.noteId === noteId && !r.noteIds)
  }
  listForVault(vaultId: string): Promise<ShareRecord[]> {
    return this.list((r) => r.vaultId === vaultId)
  }
  private list(keep: (r: MemoryShareRow) => boolean): Promise<ShareRecord[]> {
    return this.tx((rows) => [...rows.values()].filter(keep).sort((a, b) => b.createdAt - a.createdAt).map(recordOf))
  }
  getOwn(id: string): Promise<{ record: ShareRecord; ciphertext: Uint8Array } | null> {
    return this.tx((rows) => {
      const r = rows.get(id)
      return r ? { record: recordOf(r), ciphertext: r.ciphertext.slice() } : null
    })
  }
  setExpiry(id: string, seconds: number | null): Promise<{ expiresAt: number | null } | 'not-found'> {
    if (seconds !== null && !(Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_EXPIRY_SECONDS)) throw new ShareError('invalid', 'bad expiry')
    return this.tx((rows) => {
      const r = rows.get(id)
      if (!r) return 'not-found' as const
      r.expiresAt = seconds === null ? null : this.now() + seconds * 1000
      return { expiresAt: r.expiresAt }
    })
  }
  setPassword(
    id: string,
    ciphertext: Uint8Array,
    password: NewSharePassword | null,
    expectedSalt: string | null,
    expectedHash: Uint8Array,
  ): Promise<GuardedWrite> {
    return this.tx(async (rows) => {
      const r = rows.get(id)
      const g = await this.guard(r, expectedSalt, expectedHash)
      if (g !== 'ok') return g
      r!.ciphertext = ciphertext.slice()
      r!.password = password && { saltB64: password.saltB64, iterations: password.iterations, pwKey: password.pwKey }
      r!.verifier = password && password.verifier.slice()
      return g
    })
  }
  renew(
    oldId: string,
    next: { id: string; wrappedKey: string; ciphertext: Uint8Array; verifier: Uint8Array | null; pwKey: string | null },
    expectedSalt: string | null,
    expectedHash: Uint8Array,
  ): Promise<GuardedWrite> {
    return this.tx(async (rows) => {
      const r = rows.get(oldId)
      const g = await this.guard(r, expectedSalt, expectedHash)
      if (g !== 'ok') return g
      if (rows.has(next.id)) throw new ShareError('unknown', 'duplicate share id')
      if (!r!.password !== !next.verifier || !r!.password !== !next.pwKey) throw new ShareError('unknown', 'password fields do not match the link')
      rows.delete(oldId)
      rows.set(next.id, {
        ...r!,
        id: next.id,
        wrappedKey: next.wrappedKey,
        ciphertext: next.ciphertext.slice(),
        verifier: next.verifier && next.verifier.slice(),
        password: r!.password && { ...r!.password, pwKey: next.pwKey! },
        createdAt: this.now(),
      })
      return g
    })
  }
  getPublic(id: string): Promise<PublicShare | null> {
    return this.tx((rows) => {
      const r = rows.get(id)
      if (!r) return null
      if (this.expired(r)) return { status: 'expired' as const }
      if (r.password) return { status: 'password' as const, saltB64: r.password.saltB64, iterations: r.password.iterations }
      return { status: 'ok' as const, ciphertext: r.ciphertext.slice() }
    })
  }
  openProtected(id: string, proof: Uint8Array): Promise<ProtectedOpen | null> {
    return this.tx(async (rows) => {
      const r = rows.get(id)
      if (!r) return null
      if (this.expired(r)) return { status: 'expired' as const }
      if (!r.verifier) return { status: 'ok' as const, ciphertext: r.ciphertext.slice(), passwordSalt: null }
      if (proof.length !== 32 || !same(await sha256(proof), r.verifier)) return { status: 'wrong' as const }
      return { status: 'ok' as const, ciphertext: r.ciphertext.slice(), passwordSalt: r.password!.saltB64 }
    })
  }

  // ---- files (migration 0008) ----
  private ownFolder(shareId: string) {
    const f = this.folders.get(shareId)
    if (!f || f.userId !== this.userId) throw new ShareError('signed-out', 'not your folder')
  }
  async claimFolder(shareId: string): Promise<void> {
    const f = this.folders.get(shareId)
    if (f && f.userId === this.userId) return
    const link = this.rows.get(shareId)
    if (f || (link && link.userId !== this.userId)) throw new ShareError('signed-out', 'folder belongs to someone else')
    this.folders.set(shareId, { userId: this.userId, createdAt: this.now() })
  }
  async uploadFile(shareId: string, objectName: string, ciphertext: Uint8Array): Promise<void> {
    this.ownFolder(shareId)
    if (ciphertext.length > MAX_SHARE_FILE_BYTES + SHARE_FILE_OVERHEAD) throw new ShareError('too-large')
    const k = `${shareId}/${objectName}`
    if (this.files.has(k)) throw new ShareError('unknown', 'object exists')
    this.files.set(k, ciphertext.slice())
  }
  async copyFiles(fromShareId: string, toShareId: string, objectNames: string[]): Promise<void> {
    this.ownFolder(fromShareId)
    this.ownFolder(toShareId)
    for (const o of objectNames) {
      const b = this.files.get(`${fromShareId}/${o}`)
      if (!b) throw new ShareError('unknown', 'no such object')
      this.files.set(`${toShareId}/${o}`, b.slice())
    }
  }
  async deleteFiles(shareId: string, objectNames: string[]): Promise<void> {
    if (!objectNames.length) return
    this.ownFolder(shareId)
    for (const o of objectNames) this.files.delete(`${shareId}/${o}`)
  }
  async releaseFolder(shareId: string): Promise<void> {
    if (!this.folders.has(shareId)) return
    this.ownFolder(shareId)
    for (const k of [...this.files.keys()]) if (k.startsWith(`${shareId}/`)) this.files.delete(k)
    this.folders.delete(shareId)
  }
  async orphanFolders(): Promise<string[]> {
    const t = this.now()
    return [...this.folders]
      .filter(([id, f]) => f.userId === this.userId && f.createdAt < t - ORPHAN_FOLDER_GRACE_MS && !this.rows.has(id))
      .map(([id]) => id)
  }
  async downloadFile(shareId: string, objectName: string): Promise<Uint8Array | null> {
    if (this.persist) this.rows = this.persist.load()
    const r = this.rows.get(shareId)
    if (!r || this.expired(r)) return null
    return this.files.get(`${shareId}/${objectName}`)?.slice() ?? null
  }
}
