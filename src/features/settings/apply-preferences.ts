import type { Prefs, Tri } from '@/core/preferences/preferences'

const FONT = { small: '15px', standard: '16px', large: '18px' } as const
const LINE = { compact: '1.6', standard: '1.8', relaxed: '2' } as const
const WIDTH = { narrow: '600px', standard: '680px', wide: '820px' } as const

const tri = (v: Tri, system: boolean) => String(v === 'system' ? system : v === 'on')

export function applyPreferences(
  p: Prefs,
  root: HTMLElement,
  media: { reduceMotion: boolean; reduceTransparency: boolean },
): void {
  root.style.setProperty('--accent', p.accent)
  root.style.setProperty('--editor-width', WIDTH[p.editorWidth])
  root.style.setProperty('--font-size-body', FONT[p.fontSize])
  root.style.setProperty('--line-height-body', LINE[p.lineHeight])
  root.dataset.reduceMotion = tri(p.reduceMotion, media.reduceMotion)
  root.dataset.reduceTransparency = tri(p.reduceTransparency, media.reduceTransparency)
}
