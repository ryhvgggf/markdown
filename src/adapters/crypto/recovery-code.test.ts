import { describe, expect, it } from 'vitest'
import { generateRecoveryCode, normalizeRecoveryCode } from './recovery-code'

describe('generateRecoveryCode', () => {
  it('produces 8 groups of 4 from the restricted alphabet', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/)
  })

  it('excludes visually ambiguous characters', () => {
    const code = generateRecoveryCode()
    expect(code).not.toMatch(/[01OIL]/)
  })

  it('is not deterministic', () => {
    expect(generateRecoveryCode()).not.toEqual(generateRecoveryCode())
  })
})

describe('normalizeRecoveryCode', () => {
  it('strips dashes and whitespace and upper-cases', () => {
    const code = generateRecoveryCode()
    const retyped = code.toLowerCase().replace(/-/g, ' ')
    expect(normalizeRecoveryCode(retyped)).toEqual(normalizeRecoveryCode(code))
  })
})
