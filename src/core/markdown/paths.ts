/** File names and paths for export, mirror and import (spec 6.5). Pure functions, no DOM. */

const MAX_BYTES = 120
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
// eslint-disable-next-line no-control-regex
const BAD = /[/\\:*?"<>|\u0000-\u001f\u007f]/g
const enc = new TextEncoder()

/** A title as a file name (no extension): invalid characters removed, ≤ 120 UTF-8 bytes, never empty. */
export function safeFileName(title: string): string {
  let s = title.replace(BAD, '').trim().replace(/[.\s]+$/, '')
  if (RESERVED.test(s)) s += '_'
  if (enc.encode(s).length > MAX_BYTES) {
    let out = ''
    let bytes = 0
    for (const ch of s) {
      const n = enc.encode(ch).length
      if (bytes + n > MAX_BYTES) break
      out += ch
      bytes += n
    }
    s = out.trim().replace(/[.\s]+$/, '')
  }
  return s || '未命名'
}

/** `name`, or `name (2)`, `name (3)`… — compared case-insensitively against `taken` (lower-case entries). */
export function uniqueName(name: string, taken: Set<string>, ext = ''): string {
  const has = (n: string) => taken.has((n + ext).toLowerCase())
  if (!has(name)) return name
  for (let i = 2; ; i++) if (!has(`${name} (${i})`)) return `${name} (${i})`
}

/** `A/B/標題.md`, unique within `taken` (lower-case full paths); the result is added to `taken`. */
export function noteFilePath(folderPath: string[], title: string, taken: Set<string>): string {
  const dir = folderPath.map(safeFileName).map((f) => f + '/').join('')
  const base = uniqueName(dir + safeFileName(title), taken, '.md')
  const path = base + '.md'
  taken.add(path.toLowerCase())
  return path
}

/** Only the characters that break a Markdown link target are escaped; CJK stays readable. */
export function encodeLinkPath(path: string): string {
  return path.replace(/[% ()<>#?[\]]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

export function decodeLinkPath(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Obsidian block ids allow letters, digits and dashes only. */
export function blockAnchor(blockId: string): string {
  return blockId.replace(/[^A-Za-z0-9-]/g, '-')
}

const JUNK = /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i

/** A path from a ZIP or a picked folder, kept inside the root; null for OS junk and directory entries. */
export function normalizeZipPath(p: string): string | null {
  if (p.endsWith('/') || p.endsWith('\\')) return null
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.' || seg === '..') continue
    parts.push(seg)
  }
  const out = parts.join('/')
  if (!out || JUNK.test(out)) return null
  return out
}

/** cyrb53: fast, non-cryptographic; 16 hex chars. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

const pad = (n: number) => String(n).padStart(2, '0')

export function localDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function localStamp(t: number): string {
  const d = new Date(t)
  return `${localDate(t)} ${pad(d.getHours())}${pad(d.getMinutes())}`
}
