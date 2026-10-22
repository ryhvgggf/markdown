import type { Prefs } from '@/core/preferences/preferences'

/** 0–1: standard deviation of luminance, normalised so a black/white checkerboard is 1. */
export function measureBusyness(pixels: Uint8ClampedArray): number {
  const n = Math.floor(pixels.length / 4)
  if (n === 0) return 0
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * pixels[i * 4]! + 0.7152 * pixels[i * 4 + 1]! + 0.0722 * pixels[i * 4 + 2]!
    sum += l
    sumSq += l * l
  }
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  return Math.min(1, std / 127.5)
}

export const BUSY_THRESHOLD = 0.25

/** Applied blur/dim: busy images get a readability floor; stored slider values are untouched. */
export function effectiveBackground(p: Prefs, busyness: number): { blur: number; dim: number } {
  if (busyness > BUSY_THRESHOLD) {
    return { blur: Math.max(p.backgroundBlur, 0.6), dim: Math.max(p.backgroundDim, 0.3) }
  }
  return { blur: p.backgroundBlur, dim: p.backgroundDim }
}

const SIZE = 64

/** Draws the image into a small canvas and measures it; null when canvas pixels are unavailable. */
export async function measureBlobBusyness(blob: Blob): Promise<number | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, SIZE, SIZE)
    bmp.close?.()
    return measureBusyness(ctx.getImageData(0, 0, SIZE, SIZE).data)
  } catch {
    return null
  }
}
