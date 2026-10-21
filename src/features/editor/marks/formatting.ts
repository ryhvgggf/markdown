import type { AnyExtension } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import Highlight from '@tiptap/extension-highlight'
import Italic from '@tiptap/extension-italic'
import Link from '@tiptap/extension-link'
import Strike from '@tiptap/extension-strike'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'

export type Swatch = { name: string; value: string }

/** Text colours: each ≥ 4.5:1 on white. */
export const TEXT_COLORS: Swatch[] = [
  { name: '灰', value: '#6E6E73' },
  { name: '紅', value: '#C62828' },
  { name: '橘', value: '#B45309' },
  { name: '綠', value: '#1F7A4D' },
  { name: '藍', value: '#1E5FB8' },
  { name: '紫', value: '#7B3FC4' },
]

/** Highlight backgrounds: light enough for #1D1D1F text at ≥ 4.5:1. */
export const HIGHLIGHT_COLORS: Swatch[] = [
  { name: '黃', value: '#FFF1A8' },
  { name: '綠', value: '#CDEFD3' },
  { name: '藍', value: '#CFE3FB' },
  { name: '粉紅', value: '#FBD3DE' },
  { name: '紫', value: '#E2D6F8' },
  { name: '橘', value: '#FFDDB5' },
]

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ALLOWED = /^(https?:|mailto:)/i

/** Only http(s) / mailto, or a scheme-less value (resolved as https by the toolbar). */
export function isSafeUrl(url: string): boolean {
  const u = url.trim()
  if (!u) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ALLOWED.test(u)
  return true
}

export function formattingExtensions(): AnyExtension[] {
  return [
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: ['mailto'],
      isAllowedUri: (url) => ALLOWED.test(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
  ]
}
