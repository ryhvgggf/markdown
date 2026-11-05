import { deriveBitsFromSecret, fromB64, toB64 } from '@/adapters/crypto/webcrypto-crypto'
import {
  MAX_EXPIRY_SECONDS,
  MAX_SHARE_FILE_BYTES,
  MAX_SHARE_FILES_BYTES,
  MAX_SHARE_NOTES,
  MIN_SHARE_PASSWORD,
  ORPHAN_FOLDER_GRACE_MS,
  SHARE_FILE_OVERHEAD,
  ShareError,
} from '@/adapters/share/types'
import type { GuardedWrite, NewSharePassword, ShareAdapter, ShareRecord } from '@/adapters/share/types'
import {
  decryptShareFile,
  decryptShareSnapshot,
  deriveSharePasswordSecrets,
  encryptShareFile,
  encryptShareSnapshot,
  shareFileRef,
  generateShareKey,
  shareProofVerifier,
  unwrapSharePwBits,
  unwrapShareKey,
  wrapSharePwBits,
  wrapShareKey,
} from '@/core/sync-engine/doc-crypto'
import { buildShareUrl, exportShareKey, fromB64Url, importShareKey, newShareId, parseShareUrl, toB64Url } from './link'
import { cleanFileInfo, MAX_SHARE_FILE_COUNT, type PendingShareFile, type ShareFile } from './files'
import type { PMNode } from '@/core/markdown/types'
import { decodeSnapshot, encodeSnapshot, sanitizeSnapshot, type AnyShareSnapshot, type MultiShareSnapshot, type ShareSnapshot } from './snapshot'

/**
 * A multi-note link's notes together with the snapshot built from them (`snapshotOfNotes`), so the list the
 * server keeps (what permanent delete matches on) cannot drift from what the link shows.
 */
export interface MultiShareContent {
  noteIds: string[]
  snapshot: MultiShareSnapshot
  /** Phase 4d: the attachments its `media` nodes point at (uploaded with the snapshot). */
  files?: PendingShareFile[]
}

/** The unlocked account sharing needs; null when signed out (sharing needs an account, opening a link does not). */
export type ShareAccount = { userId: string; vaultId: string; kek: CryptoKey }

/**
 * Owner-side operations on read-only snapshot links (phase 4a). The note does not have to be synced: the
 * snapshot is independent of the note's cloud copy.
 */
export function createShareService(deps: { adapter: ShareAdapter; account: () => ShareAccount | null; origin: string }) {
  const { adapter, origin } = deps
  const need = (): ShareAccount => {
    const a = deps.account()
    if (!a) throw new ShareError('signed-out')
    return a
  }
  const linkKeyOf = (a: ShareAccount, r: ShareRecord) => unwrapShareKey(a.kek, r.vaultId, r.id, fromB64(r.wrappedKey))
  /** The key the snapshot of `r` is encrypted with: the link key, or (with a password) the key mixed from both. */
  const contentKeyOf = async (a: ShareAccount, r: ShareRecord): Promise<CryptoKey> => {
    const linkKey = await linkKeyOf(a, r)
    if (!r.password) return linkKey
    const pwBits = await unwrapSharePwBits(a.kek, r.vaultId, r.id, fromB64(r.password.pwKey))
    return (await deriveSharePasswordSecrets(linkKey, r.id, pwBits)).contentKey
  }
  /**
   * The link's current state and plaintext snapshot, read back from the server (for re-encrypting it), and the
   * SHA-256 of that ciphertext: the write is refused if another device replaced the snapshot meanwhile.
   */
  const current = async (a: ShareAccount, id: string) => {
    const own = await adapter.getOwn(id)
    if (!own) throw new ShareError('not-found')
    const bytes = await decryptShareSnapshot(await contentKeyOf(a, own.record), id, own.ciphertext)
    return { record: own.record, bytes, hash: await shareProofVerifier(own.ciphertext) }
  }
  const settle = (g: GuardedWrite) => {
    if (g === 'not-found') throw new ShareError('not-found')
    return g === 'ok'
  }
  /** Best effort: whatever is left behind is found again by `cleanupFiles` (the folder outlives its link). */
  const quietly = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      console.warn('[share]', e)
    }
  }

  /**
   * Uploads `pending` into the link's folder for a snapshot that replaces one listing `previous`: files already
   * uploaded for the same attachment are reused, the rest are encrypted (each under a fresh key) and uploaded.
   * Checks the size limits before uploading anything. On failure, deletes what this call uploaded.
   * Returns the snapshot's `files`, what was uploaded now, and the previous objects the new snapshot no longer uses.
   */
  const uploadFiles = async (shareId: string, pending: PendingShareFile[], previous: ShareFile[]) => {
    let total = 0
    for (const p of pending) {
      if (p.size > MAX_SHARE_FILE_BYTES) throw new ShareError('file-too-large', undefined, { detail: p.name })
      total += p.size
    }
    if (total > MAX_SHARE_FILES_BYTES || pending.length > MAX_SHARE_FILE_COUNT) throw new ShareError('files-too-large')
    const reused = new Set<string>()
    const files: ShareFile[] = []
    const uploaded: string[] = []
    try {
      let claimed = false
      total = 0
      for (const p of pending) {
        const info = cleanFileInfo(p.name, p.mime)
        let found: ShareFile | undefined
        for (const f of previous) {
          if (reused.has(f.obj)) continue
          if (toB64Url(await shareFileRef(fromB64Url(f.key), p.attachmentId)) === f.ref) {
            found = f
            break
          }
        }
        if (found) {
          reused.add(found.obj)
          total += found.size
          files.push({ ...found, code: p.code, ...info })
          continue
        }
        const bytes = await p.read()
        if (bytes.length > MAX_SHARE_FILE_BYTES) throw new ShareError('file-too-large', undefined, { detail: p.name })
        total += bytes.length
        if (total > MAX_SHARE_FILES_BYTES) throw new ShareError('files-too-large')
        if (!claimed) {
          await adapter.claimFolder(shareId)
          claimed = true
        }
        const key = crypto.getRandomValues(new Uint8Array(32))
        const obj = toB64Url(crypto.getRandomValues(new Uint8Array(16)))
        await adapter.uploadFile(shareId, obj, await encryptShareFile(key, obj, bytes))
        uploaded.push(obj)
        files.push({ code: p.code, obj, key: toB64Url(key), ref: toB64Url(await shareFileRef(key, p.attachmentId)), ...info, size: bytes.length, token: '' })
      }
      if (uploaded.length) {
        const tokens = new Map((await adapter.signFiles(shareId, uploaded)).map((t, i) => [uploaded[i], t]))
        for (const f of files) if (!f.token) f.token = tokens.get(f.obj) ?? ''
        if (files.some((f) => !f.token)) throw new ShareError('unknown', 'missing download token')
      }
    } catch (e) {
      await quietly(() => adapter.deleteFiles(shareId, uploaded))
      throw e
    }
    return { files, uploaded, unused: previous.filter((f) => !reused.has(f.obj)).map((f) => f.obj) }
  }

  const withFiles = <S extends AnyShareSnapshot>(snapshot: S, files: ShareFile[]): S => {
    const { files: _ignored, ...rest } = snapshot
    void _ignored
    return (files.length ? { ...rest, files } : rest) as S
  }

  /** The files listed by a link's current snapshot (owner side). */
  const filesIn = (bytes: Uint8Array) => sanitizeSnapshot(decodeSnapshot(bytes)).files ?? []

  const createLink = async (noteIds: string[] | null, snapshot: AnyShareSnapshot, noteId: string, pending: PendingShareFile[]) => {
    const a = need()
    const id = newShareId()
    const key = await generateShareKey()
    const { files, uploaded } = await uploadFiles(id, pending, [])
    const wrappedKey = toB64(await wrapShareKey(a.kek, a.vaultId, id, key))
    let ciphertext: Uint8Array
    try {
      ciphertext = await encryptShareSnapshot(key, id, encodeSnapshot(withFiles(snapshot, files)))
    } catch (e) {
      if (uploaded.length) await quietly(() => adapter.releaseFolder(id))
      throw e
    }
    // If this fails, the row may still have been written: the files stay (an orphaned folder is cleaned up later).
    await adapter.create({ id, vaultId: a.vaultId, noteId, ...(noteIds && { noteIds }), userId: a.userId, wrappedKey, ciphertext })
    const now = Date.now()
    const record: ShareRecord = { id, vaultId: a.vaultId, noteId, noteIds, wrappedKey, createdAt: now, updatedAt: now, expiresAt: null, password: null }
    return { record, url: buildShareUrl(origin, id, await exportShareKey(key)) }
  }

  /**
   * Replaces a link's snapshot (uploading its files first), guarded on the password salt and the current snapshot;
   * on `'changed'` undoes the uploads and tries once more on the fresh state. After the write, deletes the files
   * the previous snapshot had and the new one does not.
   */
  const writeSnapshot = async (
    shareId: string,
    snapshot: AnyShareSnapshot,
    pending: PendingShareFile[],
    write: (record: ShareRecord, ciphertext: Uint8Array, hash: Uint8Array) => Promise<GuardedWrite>,
    accept: (record: ShareRecord) => void,
  ): Promise<ShareRecord> => {
    const a = need()
    for (let attempt = 0; ; attempt++) {
      const own = await adapter.getOwn(shareId)
      if (!own) throw new ShareError('not-found')
      const { record } = own
      accept(record)
      const key = await contentKeyOf(a, record)
      const previous = filesIn(await decryptShareSnapshot(key, shareId, own.ciphertext))
      const { files, uploaded, unused } = await uploadFiles(shareId, pending, previous)
      let ciphertext: Uint8Array
      try {
        ciphertext = await encryptShareSnapshot(key, shareId, encodeSnapshot(withFiles(snapshot, files)))
      } catch (e) {
        await quietly(() => adapter.deleteFiles(shareId, uploaded))
        throw e
      }
      // A write that throws may still have landed: keep the files (`cleanupFiles` removes unreferenced ones).
      const g = await write(record, ciphertext, await shareProofVerifier(own.ciphertext))
      if (g === 'ok') {
        if (unused.length) await quietly(() => adapter.deleteFiles(shareId, unused))
        return record
      }
      await quietly(() => adapter.deleteFiles(shareId, uploaded))
      settle(g)
      if (attempt > 0) throw new ShareError('unknown', 'the link keeps changing')
    }
  }

  /**
   * Writes a multi-note link's notes and snapshot together, guarded on the password salt and the current snapshot.
   * With `expectNotes`, refuses (`ShareError('unknown')`) if the link's notes are no longer those (another device
   * changed them; the caller should reload and rebuild the snapshot).
   */
  const writeNotes = async (shareId: string, { noteIds, snapshot, files }: MultiShareContent, expectNotes: string[] | null) => {
    checkNoteIds(noteIds, snapshot)
    const record = await writeSnapshot(
      shareId,
      snapshot,
      files ?? [],
      (r, ciphertext, hash) => adapter.setNotes(shareId, [...noteIds], ciphertext, r.password?.saltB64 ?? null, hash),
      (r) => {
        if (r.noteIds === null) throw new ShareError('invalid', 'not a multi-note link')
        if (expectNotes && !sameList(r.noteIds, expectNotes)) throw new ShareError('unknown', 'the notes of the link changed')
      },
    )
    return { ...record, noteId: noteIds[0], noteIds: [...noteIds], updatedAt: snapshot.sharedAt }
  }

  return {
    /**
     * Creates a new single-note link showing `snapshot` (no expiry, no password), with the attachments `files`
     * (phase 4d). `ShareError('file-too-large' | 'files-too-large')` past the limits, before anything is uploaded.
     */
    async create(noteId: string, snapshot: ShareSnapshot, files: PendingShareFile[] = []): Promise<{ record: ShareRecord; url: string }> {
      if (snapshot.v !== 1) throw new ShareError('invalid', 'not a single-note snapshot')
      return createLink(null, snapshot, noteId, files)
    },

    /**
     * Creates one link showing several notes (`noteIds`, in the order of `snapshot.notes`). `ShareError('invalid')`
     * for an empty, repeating or too long list, or one that does not match the snapshot.
     */
    async createMulti({ noteIds, snapshot, files }: MultiShareContent): Promise<{ record: ShareRecord; url: string }> {
      checkNoteIds(noteIds, snapshot)
      return createLink([...noteIds], snapshot, noteIds[0], files ?? [])
    },

    /**
     * Changes which notes a multi-note link shows, replacing its snapshot in the same write (the link, expiry and
     * password stay). Refused if another device replaced the snapshot or the password meanwhile, then retried once
     * on the fresh state. Returns the new record.
     */
    async setNotes(shareId: string, content: MultiShareContent): Promise<ShareRecord> {
      return writeNotes(shareId, content, null)
    },

    /** The link again (any device of the account). A protected link still needs its password to open. */
    async linkFor(record: ShareRecord): Promise<string> {
      const key = await linkKeyOf(need(), record)
      return buildShareUrl(origin, record.id, await exportShareKey(key))
    },

    /**
     * Replaces what the same link shows (keeps its password and, for a multi-note link, its notes).
     * `ShareError('not-found')` if the link was stopped; `'invalid'` if the snapshot kind does not match the link.
     */
    async update(record: ShareRecord, content: ShareSnapshot | MultiShareContent, files: PendingShareFile[] = []): Promise<void> {
      need()
      const multi = 'noteIds' in content
      if ((record.noteIds !== null) !== multi) throw new ShareError('invalid', 'snapshot kind does not match the link')
      // A multi-note link's list and content change together: the list is what permanent delete matches on.
      if (multi) {
        if (!sameList(record.noteIds!, content.noteIds)) throw new ShareError('invalid', 'snapshot is not of the link\'s notes')
        return void (await writeNotes(record.id, content, record.noteIds))
      }
      const snapshot = content
      if (snapshot.v !== 1) throw new ShareError('invalid', 'not a single-note snapshot')
      await writeSnapshot(
        record.id,
        snapshot,
        files,
        (r, ciphertext, hash) => adapter.update(r.id, ciphertext, r.password?.saltB64 ?? null, hash),
        (r) => {
          if (r.noteIds !== null) throw new ShareError('invalid', 'snapshot kind does not match the link')
        },
      )
    },

    /** Sets when the link stops opening, counted by the server from now (`null` = never). */
    async setExpiry(shareId: string, seconds: number | null): Promise<number | null> {
      need()
      if (seconds !== null && !(Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_EXPIRY_SECONDS)) throw new ShareError('invalid', 'bad expiry')
      const r = await adapter.setExpiry(shareId, seconds)
      if (r === 'not-found') throw new ShareError('not-found')
      return r.expiresAt
    },

    /**
     * Sets or changes the password (`null` removes it). The snapshot is re-encrypted under a new key with a new
     * salt, so the old password stops working both on the server and cryptographically. Returns the new record.
     */
    async setPassword(shareId: string, password: string | null): Promise<ShareRecord> {
      const a = need()
      if (password !== null && [...password].length < MIN_SHARE_PASSWORD) throw new ShareError('weak-password')
      for (let attempt = 0; ; attempt++) {
        const { record, bytes, hash } = await current(a, shareId)
        const linkKey = await linkKeyOf(a, record)
        let key = linkKey
        let next: NewSharePassword | null = null
        if (password !== null) {
          const { bits, params } = await deriveBitsFromSecret(password)
          const { contentKey, proof } = await deriveSharePasswordSecrets(linkKey, shareId, bits)
          key = contentKey
          next = {
            saltB64: params.saltB64,
            iterations: params.iterations,
            verifier: await shareProofVerifier(proof),
            pwKey: toB64(await wrapSharePwBits(a.kek, record.vaultId, shareId, bits)),
          }
        }
        const ciphertext = await encryptShareSnapshot(key, shareId, bytes)
        const g = await adapter.setPassword(shareId, ciphertext, next, record.password?.saltB64 ?? null, hash)
        if (settle(g))
          return { ...record, password: next && { saltB64: next.saltB64, iterations: next.iterations, pwKey: next.pwKey } }
        if (attempt > 0) throw new ShareError('unknown', 'the link keeps changing')
      }
    },

    /**
     * Replaces the link with a new one: the old link stops working at once; the note, snapshot, expiry and
     * password carry over (the same password opens the new link).
     */
    async renew(shareId: string): Promise<{ record: ShareRecord; url: string }> {
      const a = need()
      for (let attempt = 0; ; attempt++) {
        const { record, bytes, hash } = await current(a, shareId)
        const id = newShareId()
        const linkKey = await generateShareKey()
        let key = linkKey
        let verifier: Uint8Array | null = null
        let pwKey: string | null = null
        if (record.password) {
          const bits = await unwrapSharePwBits(a.kek, record.vaultId, record.id, fromB64(record.password.pwKey))
          const { contentKey, proof } = await deriveSharePasswordSecrets(linkKey, id, bits)
          key = contentKey
          verifier = await shareProofVerifier(proof)
          pwKey = toB64(await wrapSharePwBits(a.kek, record.vaultId, id, bits))
        }
        const wrappedKey = toB64(await wrapShareKey(a.kek, record.vaultId, id, linkKey))
        // The files move with the link: copied into the new link's folder (with new download tokens) first, the old
        // folder emptied after, so the old link's tokens stop working.
        const decoded = decodeSnapshot(bytes)
        const oldFiles = sanitizeSnapshot(decoded).files ?? []
        const objs = oldFiles.map((f) => f.obj)
        let content = bytes
        try {
          if (objs.length) {
            await adapter.claimFolder(id)
            await adapter.copyFiles(shareId, id, objs)
            const tokens = await adapter.signFiles(id, objs)
            if (tokens.length !== objs.length || tokens.some((t) => !t)) throw new ShareError('unknown', 'missing download token')
            content = encodeSnapshot({ ...decoded, files: oldFiles.map((f, i) => ({ ...f, token: tokens[i] })) })
          }
        } catch (e) {
          if (objs.length) await quietly(() => adapter.releaseFolder(id))
          throw e
        }
        const ciphertext = await encryptShareSnapshot(key, id, content)
        // If this throws, the renewal may still have happened: keep both folders (the orphaned one is cleaned up later).
        const g = await adapter.renew(shareId, { id, wrappedKey, ciphertext, verifier, pwKey }, record.password?.saltB64 ?? null, hash)
        if (g !== 'ok' && objs.length) await quietly(() => adapter.releaseFolder(id))
        if (g === 'ok') await quietly(() => adapter.releaseFolder(shareId))
        if (settle(g))
          return {
            record: { ...record, id, wrappedKey, createdAt: Date.now(), password: record.password && pwKey ? { ...record.password, pwKey } : null },
            url: buildShareUrl(origin, id, await exportShareKey(linkKey)),
          }
        if (attempt > 0) throw new ShareError('unknown', 'the link keeps changing')
      }
    },

    /** Stops a link; it fails to open from then on. */
    async stop(shareId: string): Promise<void> {
      need()
      await adapter.remove(shareId)
      await quietly(() => adapter.releaseFolder(shareId))
    },

    /**
     * Stops this note's own single-note links (the 停止分享 button of the note's dialog). Links that show the note
     * together with others stay: they are stopped from the 分享 page, or by deleting the note for good.
     */
    async stopForNote(noteId: string): Promise<void> {
      const a = need()
      for (const r of await adapter.listForNote(a.vaultId, noteId)) {
        await adapter.remove(r.id)
        await quietly(() => adapter.releaseFolder(r.id))
      }
    },

    async listForNote(noteId: string): Promise<ShareRecord[]> {
      return adapter.listForNote(need().vaultId, noteId)
    },

    /** Every link of this account's vault (single- and multi-note), newest first (the 分享 page). */
    async listAll(): Promise<ShareRecord[]> {
      return adapter.listForVault(need().vaultId)
    },

    /**
     * Stops every link showing any of these notes, multi-note links included (permanent delete, 停止分享; at most
     * `REMOVE_BATCH` per call).
     */
    async removeForNotes(noteIds: string[]): Promise<void> {
      await adapter.removeForNotes(need().vaultId, noteIds)
    },

    /**
     * Deletes the files of this account's links that are gone (stopped elsewhere, deleted with their note, or a
     * clean-up that failed). Never rejects; run on start and after sign-in, and after permanent deletes.
     */
    async cleanupFiles(): Promise<void> {
      const a = need()
      let ids: string[] = []
      await quietly(async () => (ids = await adapter.orphanFolders()))
      for (const id of ids) await quietly(() => adapter.releaseFolder(id))
      // Files of live links that their snapshot no longer lists (a write whose outcome was unknown); not the
      // newest ones, which another device may be about to list.
      let links: ShareRecord[] = []
      await quietly(async () => (links = await adapter.listForVault(a.vaultId)))
      for (const r of links) {
        await quietly(async () => {
          const stored = await adapter.listFiles(r.id)
          if (!stored.length) return
          const own = await adapter.getOwn(r.id)
          if (!own) return
          const used = new Set(filesIn(await decryptShareSnapshot(await contentKeyOf(a, own.record), r.id, own.ciphertext)).map((f) => f.obj))
          const cutoff = Date.now() - ORPHAN_FOLDER_GRACE_MS
          const extra = stored.filter((o) => !used.has(o.name) && o.createdAt < cutoff).map((o) => o.name)
          if (extra.length) await adapter.deleteFiles(r.id, extra)
        })
      }
    },
  }
}

export type ShareService = ReturnType<typeof createShareService>

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** A multi-note link's notes: 1 to `MAX_SHARE_NOTES` distinct ids, one per note of the snapshot. */
function checkNoteIds(noteIds: string[], snapshot: MultiShareSnapshot) {
  if (snapshot?.v !== 2) throw new ShareError('invalid', 'not a multi-note snapshot')
  const ok =
    Array.isArray(noteIds) &&
    noteIds.length >= 1 &&
    noteIds.length <= MAX_SHARE_NOTES &&
    new Set(noteIds).size === noteIds.length &&
    noteIds.every((n) => typeof n === 'string' && n.length > 0) &&
    noteIds.length === snapshot.notes.length
  if (!ok) throw new ShareError('invalid', 'bad note list')
}

/** PBKDF2 parameters a viewer accepts from the server (anything else could be a slow-down or a downgrade). */
const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 10_000_000

/**
 * Viewer side: opens a link without any account. Errors (`ShareError`):
 * - `'not-found'`: no such link (or it was stopped); `'invalid'`: malformed link, or its key does not open it;
 * - `'expired'`; `'password-required'` (call again with `password`); `'wrong-password'`;
 * - `'unknown'`: the content cannot be shown.
 * The content is untrusted: it is run through the allow-list, then through `check` (the editor's schema check,
 * which throws for a document the editor cannot show; called once per note of a multi-note link).
 */
export async function openSharedLink(
  adapter: Pick<ShareAdapter, 'getPublic' | 'openProtected'>,
  url: URL,
  check?: (doc: PMNode) => void,
  password?: string,
): Promise<AnyShareSnapshot> {
  const parsed = parseShareUrl(url)
  if (!parsed) throw new ShareError('invalid', 'not a share link')
  const { shareId } = parsed
  let linkKey: CryptoKey
  try {
    linkKey = await importShareKey(parsed.key)
  } catch (e) {
    throw new ShareError('invalid', 'bad key', { cause: e })
  }
  const first = await adapter.getPublic(shareId)
  if (!first) throw new ShareError('not-found')
  if (first.status === 'expired') throw new ShareError('expired')
  let key = linkKey
  let ciphertext: Uint8Array
  if (first.status === 'ok') ciphertext = first.ciphertext
  else {
    if (password === undefined) throw new ShareError('password-required')
    const { saltB64, iterations } = first
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || !validSalt(saltB64))
      throw new ShareError('invalid', 'bad password parameters')
    const { bits } = await deriveBitsFromSecret(password, { algorithm: 'PBKDF2-SHA256', saltB64, iterations })
    const { contentKey, proof } = await deriveSharePasswordSecrets(linkKey, shareId, bits)
    const opened = await adapter.openProtected(shareId, proof)
    if (!opened) throw new ShareError('not-found')
    if (opened.status === 'expired') throw new ShareError('expired')
    if (opened.status === 'wrong') throw new ShareError('wrong-password')
    ciphertext = opened.ciphertext
    // Removed meanwhile → the link key opens it; otherwise the proof matched, so this password is the right one.
    if (opened.passwordSalt !== null) key = contentKey
  }
  let bytes: Uint8Array
  try {
    bytes = await decryptShareSnapshot(key, shareId, ciphertext)
  } catch (e) {
    throw new ShareError('invalid', 'cannot decrypt', { cause: e })
  }
  const snapshot = sanitizeSnapshot(decodeSnapshot(bytes))
  try {
    if (snapshot.v === 1) check?.(snapshot.doc)
    else for (const n of snapshot.notes) check?.(n.doc)
  } catch (e) {
    throw new ShareError('unknown', 'content cannot be shown', { cause: e })
  }
  return snapshot
}

const validSalt = (b64: string) => {
  try {
    const n = fromB64(b64).length
    return n >= 16 && n <= 32
  } catch {
    return false
  }
}

/**
 * Viewer side: one attachment of an opened link (`file` from its snapshot's `files`), decrypted.
 * `ShareError('not-found')` if the link is gone or expired, or the file is missing; `'invalid'` if the stored
 * object is not that file.
 */
export async function openShareFile(adapter: Pick<ShareAdapter, 'downloadFile'>, url: URL, file: ShareFile): Promise<Uint8Array> {
  const parsed = parseShareUrl(url)
  if (!parsed) throw new ShareError('invalid', 'not a share link')
  const ciphertext = await adapter.downloadFile(parsed.shareId, file.obj, file.token)
  if (!ciphertext) throw new ShareError('not-found')
  if (ciphertext.length !== file.size + SHARE_FILE_OVERHEAD) throw new ShareError('invalid', 'unexpected file size')
  try {
    return await decryptShareFile(fromB64Url(file.key), file.obj, ciphertext)
  } catch (e) {
    throw new ShareError('invalid', 'cannot decrypt file', { cause: e })
  }
}
