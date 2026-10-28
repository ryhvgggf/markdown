type PermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
}

/** Read-write permission of a picked folder. Handles without the API (OPFS, WebKit) are always granted. */
export async function permissionOf(h: FileSystemHandle): Promise<'granted' | 'prompt' | 'denied'> {
  const q = (h as PermissionHandle).queryPermission
  if (!q) return 'granted'
  return q.call(h, { mode: 'readwrite' })
}

/** Must run inside a user gesture (click). */
export async function askPermission(h: FileSystemHandle): Promise<boolean> {
  const r = (h as PermissionHandle).requestPermission
  if (!r) return true
  return (await r.call(h, { mode: 'readwrite' })) === 'granted'
}

export const canPickDirectory = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window
