import { describe, expect, it } from 'vitest'
import { MemoryDevices } from '@/adapters/devices/memory-devices'
import { checkInDevice, defaultDeviceName, DEVICE_REGISTERED_KEY } from './devices'

function memMeta() {
  const m = new Map<string, unknown>()
  return { m, get: async (k: string) => m.get(k), put: async (k: string, v: unknown) => void m.set(k, v), delete: async (k: string) => void m.delete(k) }
}

describe('checkInDevice', () => {
  it('registers a new device, then only refreshes last-seen', async () => {
    let t = 1
    const devices = new MemoryDevices(() => t)
    const meta = memMeta()
    expect(await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'Mac · Chrome' })).toBe('ok')
    t = 5
    expect(await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'ignored' })).toBe('ok')
    expect(await devices.list()).toEqual([{ id: 'd1', name: 'Mac · Chrome', createdAt: 1, lastSeenAt: 5 }])
  })

  it('reports a device removed elsewhere, and registers it again on the next sign-in', async () => {
    const devices = new MemoryDevices()
    const meta = memMeta()
    await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'A' })
    await devices.remove('d1')
    expect(await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'A' })).toBe('removed')
    expect(meta.m.has(DEVICE_REGISTERED_KEY)).toBe(false)
    expect(await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'A' })).toBe('ok')
    expect(await devices.list()).toHaveLength(1)
  })

  it('a different account on the same browser registers instead of counting as removed', async () => {
    const devices = new MemoryDevices()
    const meta = memMeta()
    await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u1', name: 'A' })
    devices.rows.clear() // another account's rows aren't visible (RLS)
    expect(await checkInDevice(devices, meta, { deviceId: 'd1', userId: 'u2', name: 'A' })).toBe('ok')
  })
})

describe('defaultDeviceName', () => {
  it('names common platforms', () => {
    expect(defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Mac · Chrome')
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows · Edge')
    expect(defaultDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
    expect(defaultDeviceName('')).toBe('瀏覽器')
  })
})
