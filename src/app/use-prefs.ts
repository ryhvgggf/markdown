import { useEffect, useState } from 'react'
import type { Prefs } from '@/core/preferences/preferences'
import { useServices } from './services-context'

/** Live view of preferences; re-renders when any preference changes. */
export function usePrefs(): Prefs {
  const { prefs } = useServices()
  const [value, setValue] = useState<Prefs>(() => prefs.get())
  useEffect(() => {
    return prefs.observe(setValue)
  }, [prefs])
  return value
}
