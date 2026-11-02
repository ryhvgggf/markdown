import * as Y from 'yjs'
import type { SyncError, SyncAdapter } from '@/adapters/sync/types'
import { SYNCED_PREF_KEYS, type Preferences } from '@/core/preferences/preferences'
import { bindCloudDoc, CLOUD_ORIGIN, type CloudDocBinding } from './cloud-doc'

/** The appearance-settings doc's id within a vault (design doc §5 decision 5: always synced once signed in). */
export const prefsDocId = (vaultId: string) => `${vaultId}-prefs`

const LOCAL_ORIGIN = Symbol('prefs-local')

export interface PrefsSyncDeps {
  sync: SyncAdapter
  vaultId: string
  kek: CryptoKey
  deviceId: string
  onError?: (e: SyncError) => void
}

export interface PrefsSyncBinding {
  hasPending(): boolean
  close(): Promise<void>
}

/**
 * Keeps the synced appearance settings (`SYNCED_PREF_KEYS`) in step with the account (3f-4). The local
 * `Preferences` doc is never itself sent to the cloud — it also holds device-only keys (the background
 * image id above all) — so a separate small Yjs doc carries just the synced keys, through the same
 * `bindCloudDoc` every note uses (same encryption, queue, retry and realtime).
 *
 * Direction rules: on connect, whatever the account already has wins over this device's own values for the
 * same key (a new device takes on the account's look), and keys only this device has set are uploaded.
 * Afterwards a change on either side is copied across; values are copied only when they differ and only if
 * explicitly set — never the defaults `Preferences.get()` fills in — so a device that never touched a
 * setting can't overwrite another device's choice with its default.
 */
export async function bindPrefsSync(prefs: Preferences, deps: PrefsSyncDeps): Promise<PrefsSyncBinding> {
  const mirror = new Y.Doc()
  const map = mirror.getMap<unknown>('prefs')
  const binding: CloudDocBinding = await bindCloudDoc(mirror, {
    sync: deps.sync,
    vaultId: deps.vaultId,
    docId: prefsDocId(deps.vaultId),
    kek: deps.kek,
    deviceId: deps.deviceId,
    onError: deps.onError,
  })

  // account → this device
  const pullIntoPrefs = () => {
    const values: Record<string, unknown> = {}
    for (const key of SYNCED_PREF_KEYS) if (map.has(key)) values[key] = map.get(key)
    const explicit = prefs.explicit() as Record<string, unknown>
    const changed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) if (explicit[k] !== v) changed[k] = v
    if (Object.keys(changed).length > 0) prefs.applyRemote(changed)
  }
  // this device → account
  const pushFromPrefs = () => {
    const explicit = prefs.explicit() as Record<string, unknown>
    const changed = SYNCED_PREF_KEYS.filter((k) => k in explicit && map.get(k) !== explicit[k])
    if (changed.length === 0) return
    mirror.transact(() => {
      for (const k of changed) map.set(k, explicit[k])
    }, LOCAL_ORIGIN)
  }

  pullIntoPrefs() // the account's values win on connect…
  pushFromPrefs() // …and what only this device has goes up
  const unobservePrefs = prefs.observe(pushFromPrefs)
  const onMirrorUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === CLOUD_ORIGIN) pullIntoPrefs()
  }
  mirror.on('update', onMirrorUpdate)

  return {
    hasPending: () => binding.hasPending(),
    async close() {
      unobservePrefs()
      mirror.off('update', onMirrorUpdate)
      await binding.close()
      mirror.destroy()
    },
  }
}
