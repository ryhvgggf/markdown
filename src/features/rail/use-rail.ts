import { useEffect } from 'react'
import { usePrefs } from '@/app/use-prefs'
import { useUi } from '@/app/ui-store'

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform)

/** Rail open state + the Ctrl/⌘+\ shortcut (ignored during IME composition). */
export function useRail(): { open: boolean; pinned: boolean; setOpen: (v: boolean) => void } {
  const pinned = usePrefs().railMode === 'pinned'
  const railHover = useUi((s) => s.railHover)
  const setRailHover = useUi((s) => s.setRailHover)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\') return
      if (!(isMac() ? e.metaKey : e.ctrlKey)) return
      if (e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      setRailHover(!useUi.getState().railHover)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setRailHover])

  return { open: pinned || railHover, pinned, setOpen: setRailHover }
}
