import type { DeviceAdapter } from '@/adapters/devices/types'

/** `db.meta` key: the user id this device last registered a `devices` row for. */
export const DEVICE_REGISTERED_KEY = 'deviceRegisteredFor'

export interface DeviceMeta {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Runs when sync starts (and periodically while it runs). A device whose row is gone although it registered
 * one for this same user was removed from another device: the caller signs it out ('removed'). Otherwise the
 * row is created on first use, or its last-seen time refreshed. Network errors propagate (the caller ignores
 * them: device bookkeeping never blocks sync).
 */
export async function checkInDevice(
  devices: DeviceAdapter,
  meta: DeviceMeta,
  a: { deviceId: string; userId: string; name: string },
): Promise<'ok' | 'removed'> {
  if (await devices.touch(a.deviceId)) {
    if ((await meta.get(DEVICE_REGISTERED_KEY)) !== a.userId) await meta.put(DEVICE_REGISTERED_KEY, a.userId)
    return 'ok'
  }
  if ((await meta.get(DEVICE_REGISTERED_KEY)) === a.userId) {
    await meta.delete(DEVICE_REGISTERED_KEY) // signing in again registers it anew
    return 'removed'
  }
  await devices.register(a.deviceId, a.userId, a.name)
  await meta.put(DEVICE_REGISTERED_KEY, a.userId)
  return 'ok'
}

/** A readable default name from the user agent, e.g. "Mac · Chrome" (renamable later). */
export function defaultDeviceName(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : ''
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : ''
  return [os, browser].filter(Boolean).join(' · ') || '瀏覽器'
}
