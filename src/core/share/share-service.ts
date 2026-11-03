import { fromB64, toB64 } from '@/adapters/crypto/webcrypto-crypto'
import { ShareError, type ShareAdapter, type ShareRecord } from '@/adapters/share/types'
import {
  decryptShareSnapshot,
  encryptShareSnapshot,
  generateShareKey,
  unwrapShareKey,
  wrapShareKey,
} from '@/core/sync-engine/doc-crypto'
import { buildShareUrl, exportShareKey, importShareKey, newShareId, parseShareUrl } from './link'
import { decodeSnapshot, encodeSnapshot, type ShareSnapshot } from './snapshot'

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
  const keyOf = (a: ShareAccount, r: ShareRecord) => unwrapShareKey(a.kek, r.vaultId, r.id, fromB64(r.wrappedKey))

  return {
    /** Creates a new link showing `snapshot`. */
    async create(noteId: string, snapshot: ShareSnapshot): Promise<{ record: ShareRecord; url: string }> {
      const a = need()
      const id = newShareId()
      const key = await generateShareKey()
      const ciphertext = await encryptShareSnapshot(key, id, encodeSnapshot(snapshot))
      const wrappedKey = toB64(await wrapShareKey(a.kek, a.vaultId, id, key))
      await adapter.create({ id, vaultId: a.vaultId, noteId, userId: a.userId, wrappedKey, ciphertext })
      const now = Date.now()
      return {
        record: { id, vaultId: a.vaultId, noteId, wrappedKey, createdAt: now, updatedAt: now },
        url: buildShareUrl(origin, id, await exportShareKey(key)),
      }
    },

    /** The link again (any device of the account). */
    async linkFor(record: ShareRecord): Promise<string> {
      const key = await keyOf(need(), record)
      return buildShareUrl(origin, record.id, await exportShareKey(key))
    },

    /** Replaces what the same link shows. `ShareError('not-found')` if the link was stopped. */
    async update(record: ShareRecord, snapshot: ShareSnapshot): Promise<void> {
      const key = await keyOf(need(), record)
      await adapter.update(record.id, await encryptShareSnapshot(key, record.id, encodeSnapshot(snapshot)))
    },

    /** Stops a link; it fails to open from then on. */
    async stop(shareId: string): Promise<void> {
      need()
      await adapter.remove(shareId)
    },

    async listForNote(noteId: string): Promise<ShareRecord[]> {
      return adapter.listForNote(need().vaultId, noteId)
    },

    /** For permanent delete: stops every link of the note. */
    async removeForNote(noteId: string): Promise<void> {
      await adapter.removeForNote(need().vaultId, noteId)
    },
  }
}

export type ShareService = ReturnType<typeof createShareService>

/**
 * Viewer side: opens a link without any account. `ShareError('not-found')` when the link does not exist (or
 * was stopped), `'invalid'` when the link is malformed or its key does not open the snapshot.
 */
export async function openSharedLink(adapter: Pick<ShareAdapter, 'getPublic'>, url: URL): Promise<ShareSnapshot> {
  const parsed = parseShareUrl(url)
  if (!parsed) throw new ShareError('invalid', 'not a share link')
  let key: CryptoKey
  try {
    key = await importShareKey(parsed.key)
  } catch (e) {
    throw new ShareError('invalid', 'bad key', { cause: e })
  }
  const ciphertext = await adapter.getPublic(parsed.shareId)
  if (!ciphertext) throw new ShareError('not-found')
  let bytes: Uint8Array
  try {
    bytes = await decryptShareSnapshot(key, parsed.shareId, ciphertext)
  } catch (e) {
    throw new ShareError('invalid', 'cannot decrypt', { cause: e })
  }
  return decodeSnapshot(bytes)
}
