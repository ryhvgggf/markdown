/** Leading YAML frontmatter: only `tags`, `created` / `updated` (or `date`) are read. Not a YAML parser. */
export type Frontmatter = { tags: string[]; created: number | null; updated: number | null }

const KEY_LINE = /^([\w-]+):(.*)$/
const LIST_ITEM = /^\s+-\s*(.*)$/

/** Returns the body without the frontmatter, or null when `src` has none (a `---` rule is not frontmatter). */
export function splitFrontmatter(src: string): { fm: Frontmatter; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src)
  if (!m) return null
  const lines = m[1].split('\n')
  if (!lines.some((l) => KEY_LINE.test(l)) || !lines.every((l) => !l.trim() || KEY_LINE.test(l) || /^\s/.test(l))) return null
  const fm: Frontmatter = { tags: [], created: null, updated: null }
  let listKey: string | null = null
  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')
  for (const l of lines) {
    const item = LIST_ITEM.exec(l)
    if (item && listKey === 'tags') {
      if (clean(item[1])) fm.tags.push(clean(item[1]))
      continue
    }
    const kv = KEY_LINE.exec(l)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const value = kv[2].trim()
    listKey = value ? null : key
    if (key === 'tags' || key === 'tag') {
      listKey = value ? null : 'tags'
      fm.tags.push(...value.replace(/^\[|\]$/g, '').split(/[,\s]+/).map(clean).filter(Boolean))
    } else if (key === 'created' || key === 'date') {
      const t = Date.parse(clean(value))
      if (!Number.isNaN(t)) fm.created = t
    } else if (key === 'updated' || key === 'modified') {
      const t = Date.parse(clean(value))
      if (!Number.isNaN(t)) fm.updated = t
    }
  }
  return { fm, body: src.slice(m[0].length) }
}
