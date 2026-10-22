import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { applyPreferences } from './apply-preferences'

const media = { reduceMotion: false, reduceTransparency: false }
const run = (patch = {}, m = media) => {
  const root = document.createElement('html')
  applyPreferences({ ...DEFAULT_PREFS, ...patch }, root, m)
  return root
}

describe('applyPreferences', () => {
  it('sets accent and typography variables', () => {
    const root = run({ accent: '#0B7A75', fontSize: 'large', lineHeight: 'relaxed', editorWidth: 'wide' })
    expect(root.style.getPropertyValue('--accent')).toBe('#0B7A75')
    expect(root.style.getPropertyValue('--font-size-body')).toBe('18px')
    expect(root.style.getPropertyValue('--line-height-body')).toBe('2')
    expect(root.style.getPropertyValue('--editor-width')).toBe('820px')
  })
  it('maps the other enum values', () => {
    const a = run({ fontSize: 'small', lineHeight: 'compact', editorWidth: 'narrow' })
    expect(a.style.getPropertyValue('--font-size-body')).toBe('15px')
    expect(a.style.getPropertyValue('--line-height-body')).toBe('1.6')
    expect(a.style.getPropertyValue('--editor-width')).toBe('600px')
    const b = run()
    expect(b.style.getPropertyValue('--font-size-body')).toBe('16px')
    expect(b.style.getPropertyValue('--line-height-body')).toBe('1.8')
    expect(b.style.getPropertyValue('--editor-width')).toBe('680px')
  })
  it("follows media for 'system' and is overridden by on/off", () => {
    const sys = run({}, { reduceMotion: true, reduceTransparency: false })
    expect(sys.dataset.reduceMotion).toBe('true')
    expect(sys.dataset.reduceTransparency).toBe('false')
    const on = run({ reduceMotion: 'on', reduceTransparency: 'on' })
    expect(on.dataset.reduceMotion).toBe('true')
    expect(on.dataset.reduceTransparency).toBe('true')
    const off = run({ reduceMotion: 'off', reduceTransparency: 'off' }, { reduceMotion: true, reduceTransparency: true })
    expect(off.dataset.reduceMotion).toBe('false')
    expect(off.dataset.reduceTransparency).toBe('false')
  })
})
