import type { DeviceAdapter, DeviceRecord } from './types'

/** In-memory `DeviceAdapter` for tests (one account; `now` is injectable). */
export class MemoryDevices implements DeviceAdapter {
  readonly rows = new Map<string, DeviceRecord & { userId: string }>()
  constructor(private now: () => number = Date.now) {}

  async touch(id: string): Promise<boolean> {
    const row = this.rows.get(id)
    if (row) row.lastSeenAt = this.now()
    return !!row
  }
  async register(id: string, userId: string, name: string): Promise<void> {
    if (this.rows.has(id)) return
    const t = this.now()
    this.rows.set(id, { id, userId, name, createdAt: t, lastSeenAt: t })
  }
  async list(): Promise<DeviceRecord[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }))
  }
  async rename(id: string, name: string): Promise<void> {
    const row = this.rows.get(id)
    if (row) row.name = name
  }
  async remove(id: string): Promise<void> {
    this.rows.delete(id)
  }
}
