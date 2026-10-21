import { describe, expect, it } from 'vitest'
import { ACCENTS } from './accents'
import { contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('black on white is 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
  })
  it('accepts short hex and is case-insensitive and symmetric', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#abcdef', '#ABCDEF')).toBeCloseTo(1, 5)
  })
})

describe('ACCENTS', () => {
  it('has 8 colors starting with indigo', () => {
    expect(ACCENTS).toHaveLength(8)
    expect(ACCENTS[0].hex).toBe('#4F4BC9')
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(8)
  })
  it.each(ACCENTS.map((a) => [a.name, a.hex]))('%s %s has >= 4.5:1 on white', (_n, hex) => {
    expect(contrastRatio(hex, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
})
