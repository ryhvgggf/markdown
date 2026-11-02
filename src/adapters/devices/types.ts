/**
 * `adapters/devices` — the account's device list (design doc §4 `devices`, §5 open decision 2: no limit,
 * but devices can be removed). A row's `id` is the browser's stable id from `core/sync-engine/device-id.ts`
 * — the same id `doc_updates.device_id` carries. Plain metadata, not encrypted: a name and two times.
 */
export interface DeviceRecord {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
}

export interface DeviceAdapter {
  /** Marks the device as seen now. False when it has no row (never registered, or removed from another device). */
  touch(id: string): Promise<boolean>
  /** Adds this device's row (no-op if it already exists). */
  register(id: string, userId: string, name: string): Promise<void>
  /** The signed-in user's devices, most recently seen first. */
  list(): Promise<DeviceRecord[]>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
}
