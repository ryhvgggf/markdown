import type { NotesDb } from '@/adapters/storage/db'
import type { Vault } from '@/core/vault/vault'
import { SYNC_VAULT_KEY } from './account-service'

/**
 * db.meta: attachments deleted for good whose cloud half (removal mark in the manifest, cloud copy) is not done
 * yet (`SyncManagerDeps.purgedAttachments`). Recorded at the moment of the delete, also while signed out or
 * offline, so the next sync still finishes it. Each item remembers its account's vault: another account's
 * list never touches this one. A device that never signed in records nothing (nothing of it is in any cloud).
 */
export const PURGED_ATTACHMENTS_KEY = 'syncPurgedAttachments'

type Item = { id: string; at: number; vaultId: string }

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

/** The store the sync manager of `vaultId` reads and clears. */
export function purgedAttachmentStore(db: NotesDb, vaultId: string) {
  return {
    read: async () => (await items(db)).filter((x) => x.vaultId === vaultId).map(({ id, at }) => ({ id, at })),
    remove: async (ids: string[]) => {
      const done = new Set(ids)
      await update(db, (list) => list.filter((x) => !(x.vaultId === vaultId && done.has(x.id))))
    },
  }
}
