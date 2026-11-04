import type { NotesDb } from '@/adapters/storage/db'
import type { Vault } from '@/core/vault/vault'
import { ATTACHMENT_LOCAL_DROPS_KEY } from '@/core/maintenance/maintenance'
import { SYNC_VAULT_KEY } from './account-service'

/**
 * db.meta: attachments deleted for good (`SyncManagerDeps.purgedAttachments`).
 * - Deletes made here are recorded at the moment of the delete, also while signed out or offline, so the next
 *   sync still finishes their cloud half (removal mark in the manifest, cloud copy); then they are marked `done`.
 * - Every item stays for good, together with the marks this device learned from the cloud: removal marks are
 *   permanent, and if the cloud manifest ever loses one (a manifest race, an older app version), this device
 *   puts it back on its next push.
 * Each item remembers its account's vault: another account's list never touches this one. A device that never
 * signed in records nothing (nothing of it is in any cloud).
 */
export const PURGED_ATTACHMENTS_KEY = 'syncPurgedAttachments'

type Item = { id: string; at: number; vaultId: string; done?: boolean }

async function items(db: NotesDb): Promise<Item[]> {
  const v = (await db.meta.get(PURGED_ATTACHMENTS_KEY))?.value
  return Array.isArray(v) ? v.filter((x): x is Item => !!x && typeof x.id === 'string' && typeof x.at === 'number' && typeof x.vaultId === 'string') : []
}

async function update(db: NotesDb, fn: (list: Item[]) => Item[]): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const after = fn(await items(db))
    if (after.length) await db.meta.put({ key: PURGED_ATTACHMENTS_KEY, value: after })
    else await db.meta.delete(PURGED_ATTACHMENTS_KEY)
  })
}

/** Starts recording every permanent attachment delete of `vault`. */
export function recordPurgedAttachments(db: NotesDb, vault: Vault, onError: (e: unknown) => void = () => {}): () => void {
  return vault.onAttachmentPurged((id) => {
    const at = Date.now()
    void (async () => {
      const vaultId = (await db.meta.get(SYNC_VAULT_KEY))?.value
      if (typeof vaultId !== 'string' || !vaultId) return
      await update(db, (list) => [...list.filter((x) => x.id !== id), { id, at, vaultId }])
    })().catch(onError)
  })
}

/** The store the sync manager of `vaultId` reads and updates. */
export function purgedAttachmentStore(db: NotesDb, vaultId: string) {
  const mine = async () => (await items(db)).filter((x) => x.vaultId === vaultId)
  return {
    read: async () => (await mine()).filter((x) => !x.done).map(({ id, at }) => ({ id, at })),
    known: async () => (await mine()).map(({ id, at }) => ({ id, at })),
    markDone: async (ids: string[]) => {
      const done = new Set(ids)
      await update(db, (list) => list.map((x) => (x.vaultId === vaultId && done.has(x.id) ? { ...x, done: true } : x)))
    },
    remember: async (marks: Array<{ id: string; at: number }>) => {
      await update(db, (list) => {
        const have = new Set(list.filter((x) => x.vaultId === vaultId).map((x) => x.id))
        return [...list, ...marks.filter((m) => !have.has(m.id)).map(({ id, at }) => ({ id, at, vaultId, done: true }))]
      })
    },
  }
}

/** Attachments the daily cleanup removed from this device only (`SyncManagerDeps.locallyDropped`). */
export function locallyDroppedStore(db: NotesDb) {
  const read = async (): Promise<string[]> => {
    const v = (await db.meta.get(ATTACHMENT_LOCAL_DROPS_KEY))?.value
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  return {
    read,
    remove: async (ids: string[]) => {
      await db.transaction('rw', db.meta, async () => {
        const gone = new Set(ids)
        const after = (await read()).filter((x) => !gone.has(x))
        if (after.length) await db.meta.put({ key: ATTACHMENT_LOCAL_DROPS_KEY, value: after })
        else await db.meta.delete(ATTACHMENT_LOCAL_DROPS_KEY)
      })
    },
  }
}
