import { SupabaseAuth } from '@/adapters/auth/supabase-auth'
import { SupabaseDevices } from '@/adapters/devices/supabase-devices'
import { getDeviceId } from '@/core/sync-engine/device-id'
import { SupabaseKeyStore } from '@/adapters/key-store/supabase-key-store'
import { getSupabaseClient } from '@/adapters/supabase-client'
import { SupabaseAttachmentSync } from '@/adapters/sync/supabase-attachment-sync'
import { SupabaseSync } from '@/adapters/sync/supabase-sync'
import type { StorageAdapter } from '@/adapters/storage/types'
import type { NotesDb } from '@/adapters/storage/db'
import type { NoteDocCache } from '@/core/note-doc/cache'
import { createSyncManager, type PendingRemoval } from '@/core/sync-engine/sync-manager'
import type { Preferences } from '@/core/preferences/preferences'
import type { Vault } from '@/core/vault/vault'
import { useUi } from './ui-store'
import type { Maintenance } from '@/core/maintenance/maintenance'
import { createAccountService, FIRST_SYNC_KEY, type AccountService } from './account-service'
import { locallyDroppedStore, purgedAttachmentStore } from './purged-attachments'
import { runAsSyncLeader } from './sync-leader'
import { reportingProgress } from './sync-status'

/** db.meta: cloud removals not finished yet (see `SyncManagerDeps.pendingRemovals`). */
const PENDING_KEY = 'syncPendingRemovals'

export interface CloudAccountDeps {
  db: NotesDb
  storage: StorageAdapter
  vault: Vault
  notes: NoteDocCache
  prefs: Preferences
  maintenance: Maintenance
  /** The page was opened from a reset-password link (read before Supabase consumes the URL). */
  recoveryUrl: boolean
}

/** The real account service, on the configured Supabase project. Loaded on demand (see `createDeferredAccount`). */
export function createCloudAccount(d: CloudAccountDeps): AccountService {
  const client = getSupabaseClient()
  const auth = new SupabaseAuth(client, { recoveryUrl: d.recoveryUrl })
  return createAccountService({
    auth,
    keyStore: new SupabaseKeyStore(client),
    vault: d.vault,
    redirectTo: location.origin,
    devices: new SupabaseDevices(client),
    deviceId: getDeviceId,
    meta: {
      get: async (key) => (await d.db.meta.get(key))?.value,
      put: async (key, value) => void (await d.db.meta.put({ key, value })),
      delete: (key) => d.db.meta.delete(key),
    },
    startSync: ({ vaultId, kek, report }) =>
      runAsSyncLeader(
        () =>
          reportingProgress(
            createSyncManager({
              sync: new SupabaseSync(client),
              attachmentSync: new SupabaseAttachmentSync(client),
              storage: d.storage,
              noteDocs: d.notes,
              vault: d.vault,
              prefs: d.prefs,
              priorityNoteId: () => useUi.getState().openNoteId,
              onFirstMerge: async ({ cloudHasNotes }) => {
                // The first time this device meets the account: it made its own starter guide before signing in, and
                // the account's notes are now here. If that guide was never touched, it is only a second copy.
                if ((await d.db.meta.get(FIRST_SYNC_KEY))?.value !== vaultId) return
                await d.db.meta.delete(FIRST_SYNC_KEY)
                if (!cloudHasNotes) return
                const { untouchedGuideFolderIds } = await import('@/features/guide/guide')
                for (const id of untouchedGuideFolderIds(d.vault)) await d.maintenance.purge({ kind: 'folder', id })
              },
              pendingRemovals: {
                // Scoped to the vault: another account's list must never delete anything in this one.
                read: async () => {
                  const v = (await d.db.meta.get(PENDING_KEY))?.value as { vaultId?: string; items?: PendingRemoval[] } | undefined
                  return v?.vaultId === vaultId && Array.isArray(v.items) ? v.items : []
                },
                write: async (items) => void (await d.db.meta.put({ key: PENDING_KEY, value: { vaultId, items } })),
              },
              purgedAttachments: purgedAttachmentStore(d.db, vaultId),
              locallyDropped: locallyDroppedStore(d.db),
              onAttachmentsRemovedElsewhere: (ids) => d.maintenance.removeAttachmentsDeletedElsewhere(ids),
              vaultId,
              kek,
              onError: (e, info) => {
                console.warn('[sync]', info.docId, e)
                report.error(e, info.docId)
              },
            }),
            report,
          ),
        { onError: (e) => console.warn('[sync]', e) },
      ),
  })
}
