/** Attachment rules shared by the editor and import (no DOM). */

export const MAX_ATTACHMENT_BYTES = 104_857_600

export type MediaKind = 'image' | 'video' | 'file'

/** SVG can carry scripts that run with the app's origin when the blob: URL is opened in a tab (M6). */
export const isSvg = (mimeType: string, name = '') => /^image\/svg/i.test(mimeType) || /\.svgz?$/i.test(name)

/** Images and videos are shown; anything else is a file block (download only). */
export function mediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
