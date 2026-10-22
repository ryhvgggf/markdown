// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast } from '@/features/editor/marks/formatting'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]

describe('link colour tokens (R20)', () => {
  it.each([
    ['color-link-note', '#0066D6'],
    ['color-link-block', '#9B3FCC'],
    ['color-link-external', '#0B7C87'], // #0B7F8A darkened minimally: it was 4.37:1 on #F5F5F7
  ])('%s is %s', (name, hex) => {
    expect(token(name)?.toUpperCase()).toBe(hex)
  })

  it.each(['color-link-note', 'color-link-block', 'color-link-external'])('%s meets WCAG AA on the note card and callouts', (name) => {
    const hex = token(name)!
    expect(contrast(hex, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex, '#F5F5F7')).toBeGreaterThanOrEqual(4.5)
  })
})
