import { newId } from '../ids'

/**
 * A stable id for this browser (not this account or this vault), generated once and kept in `localStorage`
 * — it labels which device pushed each `doc_updates` row (design doc §4 `device_id`) and lets
 * `core/sync-engine`'s realtime binding skip pulling back its own pushes (see `cloud-doc.ts`). It is not the
 * `devices` table's row id (device registration/listing is out of scope here — see the phase 3d summary);
 * it only needs to be stable and distinct per browser, not globally registered.
 */
const KEY = 'notes-v2:device-id'

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

let cached: string | null = null

/** Same id for the lifetime of this browser's storage; a fresh random one (not persisted) if storage is unavailable. */
export function getDeviceId(): string {
  if (cached) return cached
  const store = ls()
  try {
    const existing = store?.getItem(KEY)
    if (existing) return (cached = existing)
    const fresh = newId()
    store?.setItem(KEY, fresh)
    return (cached = fresh)
  } catch {
    return (cached = newId())
  }
}
