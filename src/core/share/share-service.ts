import { deriveBitsFromSecret, fromB64, toB64 } from '@/adapters/crypto/webcrypto-crypto'
import { MAX_EXPIRY_SECONDS, MAX_SHARE_NOTES, MIN_SHARE_PASSWORD, ShareError } from '@/adapters/share/types'
import type { GuardedWrite, NewSharePassword, ShareAdapter, ShareRecord } from '@/adapters/share/types'
import {
  decryptShareSnapshot,
  deriveSharePasswordSecrets,
  encryptShareSnapshot,
  generateShareKey,
  shareProofVerifier,
  unwrapSharePwBits,
  unwrapShareKey,
  wrapSharePwBits,
  wrapShareKey,
} from '@/core/sync-engine/doc-crypto'
import { buildShareUrl, exportShareKey, importShareKey, newShareId, parseShareUrl } from './link'
import type { PMNode } from '@/core/markdown/types'
import { decodeSnapshot, encodeSnapshot, sanitizeSnapshot, type AnyShareSnapshot, type MultiShareSnapshot, type ShareSnapshot } from './snapshot'

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
  /**
   * Runs a write that depends on the link's password; if another device changed the password meanwhile
   * (`'changed'`), runs it once more on the fresh state.
   */
  const withFresh = async <T>(id: string, first: ShareRecord | null, write: (r: ShareRecord) => Promise<{ g: GuardedWrite; out: T }>) => {
    let r = first ?? (await adapter.getOwn(id))?.record
    for (let attempt = 0; ; attempt++) {
      if (!r) throw new ShareError('not-found')
      const { g, out } = await write(r)
      if (settle(g)) return out
      if (attempt > 0) throw new ShareError('unknown', 'the link keeps changing')
      r = (await adapter.getOwn(id))?.record
    }
  }

  const createLink = async (noteIds: string[] | null, snapshot: AnyShareSnapshot, noteId: string) => {
    const a = need()
    const id = newShareId()
    const key = await generateShareKey()
    const ciphertext = await encryptShareSnapshot(key, id, encodeSnapshot(snapshot))
    const wrappedKey = toB64(await wrapShareKey(a.kek, a.vaultId, id, key))
    await adapter.create({ id, vaultId: a.vaultId, noteId, ...(noteIds && { noteIds }), userId: a.userId, wrappedKey, ciphertext })
    const now = Date.now()
    const record: ShareRecord = { id, vaultId: a.vaultId, noteId, noteIds, wrappedKey, createdAt: now, updatedAt: now, expiresAt: null, password: null }
    return { record, url: buildShareUrl(origin, id, await exportShareKey(key)) }
  }

  /**
   * Writes a multi-note link's notes and snapshot together, guarded on the password salt and the current snapshot.
   * With `expectNotes`, refuses (`ShareError('unknown')`) if the link's notes are no longer those (another device
   * changed them; the caller should reload and rebuild the snapshot).
   */
  const writeNotes = async (shareId: string, noteIds: string[], snapshot: MultiShareSnapshot, expectNotes: string[] | null) => {
    const a = need()
    checkNoteIds(noteIds, snapshot)
    const bytes = encodeSnapshot(snapshot)
    for (let attempt = 0; ; attempt++) {
      const own = await adapter.getOwn(shareId)
      if (!own) throw new ShareError('not-found')
      const { record } = own
      if (record.noteIds === null) throw new ShareError('invalid', 'not a multi-note link')
      if (expectNotes && !sameList(record.noteIds, expectNotes)) throw new ShareError('unknown', 'the notes of the link changed')
      const ciphertext = await encryptShareSnapshot(await contentKeyOf(a, record), shareId, bytes)
      const g = await adapter.setNotes(shareId, [...noteIds], ciphertext, record.password?.saltB64 ?? null, await shareProofVerifier(own.ciphertext))
      if (settle(g)) return { ...record, noteId: noteIds[0], noteIds: [...noteIds], updatedAt: snapshot.sharedAt }
      if (attempt > 0) throw new ShareError('unknown', 'the link keeps changing')
    }
  }

  return {
    /** Creates a new single-note link showing `snapshot` (no expiry, no password). */
    async create(noteId: string, snapshot: ShareSnapshot): Promise<{ record: ShareRecord; url: string }> {
      if (snapshot.v !== 1) throw new ShareError('invalid', 'not a single-note snapshot')
      return createLink(null, snapshot, noteId)
    },

    /**
     * Creates one link showing several notes (`noteIds`, in the order of `snapshot.notes`). `ShareError('invalid')`
     * for an empty, repeating or too long list, or one that does not match the snapshot.
     */
    async createMulti(noteIds: string[], snapshot: MultiShareSnapshot): Promise<{ record: ShareRecord; url: string }> {
      checkNoteIds(noteIds, snapshot)
      return createLink([...noteIds], snapshot, noteIds[0])
    },

    /**
     * Changes which notes a multi-note link shows, replacing its snapshot in the same write (the link, expiry and
     * password stay). Refused if another device replaced the snapshot or the password meanwhile, then retried once
     * on the fresh state. Returns the new record.
     */
    async setNotes(shareId: string, noteIds: string[], snapshot: MultiShareSnapshot): Promise<ShareRecord> {
      return writeNotes(shareId, noteIds, snapshot, null)
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
    async update(record: ShareRecord, snapshot: AnyShareSnapshot): Promise<void> {
      const a = need()
      if ((record.noteIds === null) !== (snapshot.v === 1)) throw new ShareError('invalid', 'snapshot kind does not match the link')
      // A multi-note link's list and content change together: the list is what permanent delete matches on.
      if (record.noteIds && snapshot.v === 2) return void (await writeNotes(record.id, record.noteIds, snapshot, record.noteIds))
      const bytes = encodeSnapshot(snapshot)
      await withFresh(record.id, record, async (r) => {
        const ciphertext = await encryptShareSnapshot(await contentKeyOf(a, r), r.id, bytes)
        return { g: await adapter.update(r.id, ciphertext, r.password?.saltB64 ?? null), out: undefined }
      })
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
        const ciphertext = await encryptShareSnapshot(key, id, bytes)
        const wrappedKey = toB64(await wrapShareKey(a.kek, record.vaultId, id, linkKey))
        const g = await adapter.renew(shareId, { id, wrappedKey, ciphertext, verifier, pwKey }, record.password?.saltB64 ?? null, hash)
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
  }
}

export type ShareService = ReturnType<typeof createShareService>

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** A multi-note link's notes: 1 to `MAX_SHARE_NOTES` distinct ids, one per note of the snapshot. */
function checkNoteIds(noteIds: string[], snapshot: MultiShareSnapshot) {
  if (snapshot.v !== 2) throw new ShareError('invalid', 'not a multi-note snapshot')
  const ok =
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
