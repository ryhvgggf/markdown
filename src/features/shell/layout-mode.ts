import { useEffect, useState } from 'react'

export type LayoutMode = 'wide' | 'medium' | 'narrow'

export function layoutModeFor(width: number): LayoutMode {
  if (width >= 1440) return 'wide'
  if (width >= 1100) return 'medium'
  return 'narrow'
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(() => layoutModeFor(window.innerWidth))
  useEffect(() => {
    const onResize = () => setMode(layoutModeFor(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return mode
}
