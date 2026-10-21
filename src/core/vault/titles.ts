export function normalizeTitle(t: string): string {
  return t.trim().toLowerCase()
}

export function displayTitle(t: string): string {
  return t.trim() === '' ? '未命名' : t
}

/** `taken` holds titles (any case/spacing); returns `title` or `title (n)` not colliding with them. */
export function dedupeTitle(title: string, taken: Set<string>): string {
  const norm = new Set([...taken].map(normalizeTitle))
  const base = title.trim()
  if (!norm.has(normalizeTitle(base))) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!norm.has(normalizeTitle(candidate))) return candidate
  }
}
