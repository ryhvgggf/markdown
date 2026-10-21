import { describe, expect, it } from 'vitest'
import { dedupeTitle, displayTitle, normalizeTitle } from './titles'

describe('titles', () => {
  it('normalizes', () => expect(normalizeTitle('  SAP ')).toBe('sap'))
  it('displays 未命名 for blank', () => {
    expect(displayTitle('   ')).toBe('未命名')
    expect(displayTitle('a')).toBe('a')
  })
  it('dedupes with suffix', () => {
    expect(dedupeTitle('採購', new Set(['採購', '採購 (2)']))).toBe('採購 (3)')
    expect(dedupeTitle('X', new Set())).toBe('X')
  })
  it('dedupes against normalized taken set', () => {
    expect(dedupeTitle('SAP', new Set(['sap']))).toBe('SAP (2)')
  })
})
