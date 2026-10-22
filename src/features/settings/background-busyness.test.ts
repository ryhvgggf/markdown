import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { effectiveBackground, measureBusyness } from './background-busyness'

function fill(n: number, f: (i: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) px.set([f(i), f(i), f(i), 255], i * 4)
  return px
}

describe('measureBusyness', () => {
  it('is ~0 for a flat colour', () => {
    expect(measureBusyness(fill(64, () => 120))).toBeLessThan(0.01)
  })
  it('is ~1 for a black and white checkerboard', () => {
    expect(measureBusyness(fill(64, (i) => (i % 2 ? 255 : 0)))).toBeGreaterThan(0.95)
  })
  it('is 0 for empty data', () => {
    expect(measureBusyness(new Uint8ClampedArray(0))).toBe(0)
  })
})

describe('effectiveBackground', () => {
  const p = { ...DEFAULT_PREFS, backgroundBlur: 0.2, backgroundDim: 0.1 }
  it('keeps user values for calm images', () => {
    expect(effectiveBackground(p, 0.1)).toEqual({ blur: 0.2, dim: 0.1 })
  })
  it('raises the floor for busy images', () => {
    expect(effectiveBackground(p, 0.5)).toEqual({ blur: 0.6, dim: 0.3 })
  })
  it('never lowers values already above the floor', () => {
    expect(effectiveBackground({ ...p, backgroundBlur: 0.9, backgroundDim: 0.8 }, 1)).toEqual({ blur: 0.9, dim: 0.8 })
  })
})
