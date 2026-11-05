import { useMemo, useState } from 'react'
import { MAX_SHARE_NOTES } from '@/adapters/share/types'
import { displayTitle } from '@/core/vault/titles'
import type { TreeNode } from '@/core/vault/tree'
import { Button } from '@/ui/components/Button'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'

/** Fewest notes a multi-note link makes sense for (one note has its own 分享 button). */
export const MIN_PICKED = 2

type Row = { kind: 'folder'; id: string; name: string; depth: number } | { kind: 'note'; id: string; title: string; depth: number }

/** The tree as a flat list, in the sidebar's stored order; with a search, only matching notes and the folders above them. */
function flatten(tree: TreeNode[], query: string, depth = 0): Row[] {
  const q = query.trim().toLowerCase()
  const rows: Row[] = []
  for (const n of tree) {
    if (n.kind === 'note') {
      const title = displayTitle(n.note.title)
      if (!q || title.toLowerCase().includes(q)) rows.push({ kind: 'note', id: n.note.id, title, depth })
    } else {
      const inner = flatten(n.children, query, depth + 1)
      if (inner.length) rows.push({ kind: 'folder', id: n.folder.id, name: n.folder.name, depth }, ...inner)
    }
  }
  return rows
}

/** Every note id in tree order: the order the share page lists the notes in. */
const orderOf = (tree: TreeNode[]): string[] => tree.flatMap((n) => (n.kind === 'note' ? [n.note.id] : orderOf(n.children)))

/**
 * Picks the notes of a multi-note link: the notes grouped by folder, a search, a count (at most `MAX_SHARE_NOTES`).
 * `onSubmit` gets the picked ids in the order of the folder tree.
 */
export function NotePicker({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: string[]
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit: (ids: string[]) => void
  onCancel: () => void
}) {
  const { tree } = useVaultSnapshot()
  const [picked, setPicked] = useState(() => new Set(initial))
  const [query, setQuery] = useState('')
  const rows = useMemo(() => flatten(tree, query), [tree, query])
  const order = useMemo(() => orderOf(tree), [tree])
  const count = order.filter((id) => picked.has(id)).length
  const full = count >= MAX_SHARE_NOTES
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        aria-label="搜尋筆記"
        placeholder="搜尋筆記"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 w-full rounded-control border border-black/10 bg-white/70 px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <ul className="max-h-72 overflow-auto rounded-control border border-black/10 bg-white/50 py-1">
        {rows.length === 0 && <li className="px-3 py-2 text-sm text-fg-tertiary">沒有符合的筆記</li>}
        {rows.map((r) =>
          r.kind === 'folder' ? (
            <li key={`f-${r.id}`} className="truncate px-3 pt-1.5 pb-0.5 text-xs font-medium text-fg-tertiary" style={{ paddingLeft: 12 + r.depth * 16 }}>
              {r.name}
            </li>
          ) : (
            <li key={r.id}>
              <label className="flex min-h-8 cursor-pointer items-center gap-2 px-3 text-sm text-fg hover:bg-fill" style={{ paddingLeft: 12 + r.depth * 16 }}>
                <input type="checkbox" checked={picked.has(r.id)} disabled={busy || (full && !picked.has(r.id))} onChange={() => toggle(r.id)} />
                <span className="truncate">{r.title}</span>
              </label>
            </li>
          ),
        )}
      </ul>
      <p className="text-xs text-fg-tertiary">
        已選 {count}／{MAX_SHARE_NOTES}
        {count < MIN_PICKED && `・至少選 ${MIN_PICKED} 篇`}
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" disabled={busy || count < MIN_PICKED} onClick={() => onSubmit(order.filter((id) => picked.has(id)))}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
