import { describe, expect, it } from 'vitest'
import {
  blockAnchor, decodeLinkPath, encodeLinkPath, hashText, localDate, localStamp, normalizeZipPath, noteFilePath, safeFileName, uniqueName,
} from './paths'

describe('paths', () => {
  it('cleans file names', () => {
    expect(safeFileName('a/b:c*?')).toBe('abc')
    expect(safeFileName('  報告.  ')).toBe('報告')
    expect(safeFileName('con')).toBe('con_')
    expect(safeFileName('LPT9')).toBe('LPT9_')
    expect(safeFileName('a\u0001b')).toBe('ab')
    expect(safeFileName('')).toBe('未命名')
    expect(safeFileName('???')).toBe('未命名')
  })

  it('cuts at 120 UTF-8 bytes on a character boundary', () => {
    const long = '測'.repeat(50)
    expect(new TextEncoder().encode(safeFileName(long)).length).toBeLessThanOrEqual(120)
    expect(safeFileName(long)).toBe('測'.repeat(40))
    expect(safeFileName('😀'.repeat(31))).toBe('😀'.repeat(30))
    expect(safeFileName('😀'.repeat(31))).not.toContain('�')
  })

  it('dedupes names case-insensitively', () => {
    expect(uniqueName('A', new Set(['a']))).toBe('A (2)')
    expect(uniqueName('A', new Set(['a', 'a (2)']))).toBe('A (3)')
    expect(uniqueName('B', new Set(['a']))).toBe('B')
  })

  it('builds note paths and registers them', () => {
    const taken = new Set<string>()
    expect(noteFilePath(['資料夾'], 'x/y', taken)).toBe('資料夾/xy.md')
    expect(noteFilePath(['資料夾'], 'xy', taken)).toBe('資料夾/xy (2).md')
    expect(noteFilePath([], 'xy', taken)).toBe('xy.md')
  })

  it('encodes only what breaks a Markdown link', () => {
    expect(encodeLinkPath('附件/a b(1).png')).toBe('附件/a%20b%281%29.png')
    expect(decodeLinkPath('附件/a%20b%281%29.png')).toBe('附件/a b(1).png')
    expect(decodeLinkPath('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('block anchors use only letters, digits and dashes', () => {
    expect(blockAnchor('aB_3-x')).toBe('aB-3-x')
  })

  it('normalizes zip paths', () => {
    expect(normalizeZipPath('../../x.md')).toBe('x.md')
    expect(normalizeZipPath('/a/./b.md')).toBe('a/b.md')
    expect(normalizeZipPath('a\\b.md')).toBe('a/b.md')
    expect(normalizeZipPath('__MACOSX/a.md')).toBeNull()
    expect(normalizeZipPath('a/.DS_Store')).toBeNull()
    expect(normalizeZipPath('Thumbs.db')).toBeNull()
    expect(normalizeZipPath('dir/')).toBeNull()
  })

  it('hashes and formats dates', () => {
    expect(hashText('a')).toMatch(/^[0-9a-f]{16}$/)
    expect(hashText('a')).not.toBe(hashText('b'))
    const t = new Date(2026, 9, 8, 9, 5).getTime()
    expect(localDate(t)).toBe('2026-10-08')
    expect(localStamp(t)).toBe('2026-10-08 0905')
  })
})
