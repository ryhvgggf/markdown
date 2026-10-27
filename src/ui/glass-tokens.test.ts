// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/core/preferences/contrast'

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const glass = readFileSync(new URL('./glass.css', import.meta.url), 'utf8')
const hex = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
const rgba = (name: string) => {
  const m = tokens.match(new RegExp(`--${name}:\\s*rgba\\(([^)]+)\\)`))?.[1]
  return m?.split(',').map(Number) as [number, number, number, number] | undefined
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** `fill` (with alpha) composited over the opaque `under`. */
const over = (fill: [number, number, number, number], under: string) => toHex(parse(under).map((u, i) => fill[3] * fill[i] + (1 - fill[3]) * u))

// The darkest point of the default page background: the blue radial tint (.55) over #e4e9f0.
const DEFAULT_BG = toHex([0.55 * 160 + 0.45 * 0xe4, 0.55 * 196 + 0.45 * 0xe9, 0.55 * 255 + 0.45 * 0xf0])

describe('shared glass material', () => {
  it('standard glass is rgba(255,255,255,.34) with blur 30px, saturate 200%, brightness 1.04', () => {
    expect(rgba('glass-bg')).toEqual([255, 255, 255, 0.34])
    expect(tokens).toMatch(/--glass-filter:\s*blur\(30px\) saturate\(200%\) brightness\(1\.04\)/)
    expect(tokens).toMatch(/--glass-panel-filter:\s*blur\(9px\) saturate\(190%\)/)
    expect(rgba('glass-card-bg')).toEqual([255, 255, 255, 0.55])
  })

  it.each([
    ['the note card (paper)', '#ffffff'],
    ['the default background', DEFAULT_BG],
  ])('menu text on glass over %s meets 4.5:1', (_where, under) => {
    const bg = over(rgba('glass-bg')!, under)
    for (const t of ['color-fg', 'color-fg-secondary']) expect(contrastRatio(hex(t)!, bg), t).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to near-opaque white where backdrop-filter is unsupported, and under 降低透明度', () => {
    expect(glass).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/)
    expect(glass).toMatch(/data-reduce-transparency='true'/)
  })
})
