import { describe, expect, it } from 'vitest'
import { bytesToPgHex, pgHexToBytes } from './supabase-sync'

describe('bytesToPgHex / pgHexToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37))
    expect(Array.from(pgHexToBytes(bytesToPgHex(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips empty input', () => {
    expect(Array.from(pgHexToBytes(bytesToPgHex(new Uint8Array())))).toEqual([])
  })

  it('produces the `\\x`-prefixed hex format Postgres bytea expects', () => {
    expect(bytesToPgHex(new Uint8Array([0, 255, 16]))).toBe('\\x00ff10')
  })

  it('pgHexToBytes also accepts hex without the \\x prefix', () => {
    expect(Array.from(pgHexToBytes('00ff10'))).toEqual([0, 255, 16])
  })
})
