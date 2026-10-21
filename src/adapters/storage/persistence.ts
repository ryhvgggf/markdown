export async function requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!storage?.persist) return 'unsupported'
  try {
    if (await storage.persisted?.()) return 'granted'
    return (await storage.persist()) ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
