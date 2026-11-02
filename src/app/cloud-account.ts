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
import { createSyncManager } from '@/core/sync-engine/sync-manager'
import type { Preferences } from '@/core/preferences/preferences'
import type { Vault } from '@/core/vault/vault'
import { useUi } from './ui-store'
import { createAccountService, type AccountService } from './account-service'
import { runAsSyncLeader } from './sync-leader'
import { reportingProgress } from './sync-status'

export interface CloudAccountDeps {
  db: NotesDb
  storage: StorageAdapter
  vault: Vault
  notes: NoteDocCache
  prefs: Preferences
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
