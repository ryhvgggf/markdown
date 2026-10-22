import { useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { displayTitle, normalizeTitle } from '@/core/vault/titles'
import type { FolderMeta } from '@/core/vault/types'
import type { SearchHit } from '@/core/search/search'

export type Row =
  | { kind: 'note'; key: string; noteId: string; title: string; right: string; match: boolean }
  | { kind: 'create'; key: string; title: string }

const DEBOUNCE_MS = 80
const RECENT = 8

function folderPath(folders: Map<string, FolderMeta>, folderId: string | null): string {
  const names: string[] = []
  for (let cur = folderId ? folders.get(folderId) : undefined, g = 0; cur && g < 50; g++) {
    names.unshift(cur.name)
    cur = cur.parentId ? folders.get(cur.parentId) : undefined
  }
  return names.join(' / ')
}

/** Rows for the quick switcher: recent notes, or debounced full-text hits, plus the create row. */
export function useSwitcherRows(query: string): { rows: Row[]; settled: boolean; failed: boolean } {
  const { vault, search } = useServices()
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ q: string; hits: SearchHit[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)
  useEffect(() => vault.observe(() => setVersion((v) => v + 1)), [vault])

  const q = query.trim()
  // "#tag" searches tags only; the bare "#" has nothing to look up yet.
  const tagMode = q.startsWith('#')
  const term = tagMode ? q.slice(1).trim() : q

  useEffect(() => {
    const id = ++latest.current
    if (!term) return
    const timer = setTimeout(() => {
      search.search(term).then(
        (hits) => {
          if (id === latest.current) setResult({ q: term, hits })
        },
        () => {
          if (id === latest.current) setFailed(true)
        },
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, search])

  const rows = useMemo<Row[]>(() => {
    void version
    const folders = new Map(vault.listFolders({ includeTrashed: true }).map((f) => [f.id, f]))
    const out: Row[] = []
    if (!q) {
      const live = vault.listNotes().reverse().sort((a, b) => b.updatedAt - a.updatedAt)
      for (const n of live.slice(0, RECENT)) {
        out.push({ kind: 'note', key: n.id, noteId: n.id, title: displayTitle(n.title), right: folderPath(folders, n.folderId), match: false })
      }
      return out
    }
    for (const h of result?.hits ?? []) {
      const n = vault.getNote(h.noteId)
      if (!n || n.deletedAt !== null) continue
      if (tagMode && h.field !== 'tag') continue
      const right =
        h.field === 'title' ? folderPath(folders, n.folderId) : h.field === 'tag' ? h.snippet : `內文提到「${h.snippet}」`
      out.push({ kind: 'note', key: n.id, noteId: n.id, title: displayTitle(n.title), right, match: h.field === 'title' })
    }
    const exact = vault.listNotes().some((n) => normalizeTitle(n.title) === normalizeTitle(q))
    if (!tagMode && !exact) out.push({ kind: 'create', key: 'create', title: q })
    return out
  }, [q, tagMode, result, vault, version])

  return { rows, settled: !term || result?.q === term, failed }
}
