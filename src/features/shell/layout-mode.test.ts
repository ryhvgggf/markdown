import { describe, expect, it } from 'vitest'
import { layoutModeFor } from './layout-mode'

describe('layoutModeFor', () => {
  it('maps widths to modes', () => {
    expect(layoutModeFor(1440)).toBe('wide')
    expect(layoutModeFor(1439)).toBe('medium')
    expect(layoutModeFor(1100)).toBe('medium')
    expect(layoutModeFor(1099)).toBe('narrow')
  })
})
