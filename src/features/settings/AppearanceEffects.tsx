import { useEffect } from 'react'
import { usePrefs } from '@/app/use-prefs'
import { applyPreferences } from './apply-preferences'

const MOTION = '(prefers-reduced-motion: reduce)'
const TRANSPARENCY = '(prefers-reduced-transparency: reduce)'

function query(q: string): MediaQueryList | null {
  try {
    return typeof matchMedia === 'function' ? matchMedia(q) : null
  } catch {
    return null
  }
}

/** Applies preferences to <html> on start and on every change, including OS reduce-* changes. */
export function AppearanceEffects() {
  const prefs = usePrefs()
  useEffect(() => {
    const motion = query(MOTION)
    const transparency = query(TRANSPARENCY)
    const apply = () =>
      applyPreferences(prefs, document.documentElement, {
        reduceMotion: motion?.matches ?? false,
        reduceTransparency: transparency?.matches ?? false,
      })
    apply()
    motion?.addEventListener?.('change', apply)
    transparency?.addEventListener?.('change', apply)
    return () => {
      motion?.removeEventListener?.('change', apply)
      transparency?.removeEventListener?.('change', apply)
    }
  }, [prefs])
  return null
}
