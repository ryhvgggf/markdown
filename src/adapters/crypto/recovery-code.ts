/**
 * The one-time recovery code shown at sign-up (design doc §2). 32 symbols from a 32-character alphabet
 * (5 bits/symbol, so `randomByte % 32` is exactly unbiased — 256 is a multiple of 32), excluding visually
 * ambiguous characters (0/O, 1/I/L). Displayed grouped as 8x4 for readability; the grouping is cosmetic,
 * `normalizeRecoveryCode` strips it back out before the code is used as KDF input.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 32 chars, no 0/O/1/I/L
const LENGTH = 32
const GROUP_SIZE = 4

export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH))
  let flat = ''
  for (const b of bytes) flat += ALPHABET[b % ALPHABET.length]
  const groups: string[] = []
  for (let i = 0; i < flat.length; i += GROUP_SIZE) groups.push(flat.slice(i, i + GROUP_SIZE))
  return groups.join('-')
}

/** Strips grouping/whitespace and upper-cases, so a pasted or re-typed code compares equal. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}
