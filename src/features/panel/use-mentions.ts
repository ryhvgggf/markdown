import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { linkMention } from '@/core/links/link-mention'
import type { SearchHit } from '@/core/search/search'

const DEBOUNCE_MS = 300
const isBlank = (title: string) => !title.trim() || title.trim() === '未命名'

/** Notes whose body mentions `title` but do not link to `noteId`, plus the 轉為連結 action. */
export function useMentions(noteId: string, title: string, linkedIds: string[]) {
  const { search, notes } = useServices()
  const [res, setRes] = useState<{ base: string; full: string; hits: SearchHit[] } | null>(null)
  const [hiddenState, setHidden] = useState<{ base: string; ids: Set<string> }>({ base: '', ids: new Set() })
  const linkedKey = linkedIds.slice().sort().join(',')
  const base = `${noteId}\n${title}`
  const full = `${base}\n${linkedKey}`

  useEffect(() => {
    if (isBlank(title)) return
    let cancelled = false
    const timer = setTimeout(() => {
      const set = (hits: SearchHit[]) => !cancelled && setRes({ base, full, hits })
      search.mentions(title.trim(), [noteId, ...(linkedKey ? linkedKey.split(',') : [])]).then(set, () => set([]))
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, noteId, title, linkedKey, base, full])

  const hidden = hiddenState.base === base ? hiddenState.ids : new Set<string>()
  const setHiddenIds = (fn: (s: Set<string>) => Set<string>) =>
    setHidden((cur) => ({ base, ids: fn(cur.base === base ? cur.ids : new Set()) }))

  const convert = async (sourceId: string) => {
    setHiddenIds((s) => new Set(s).add(sourceId)) // optimistic: the indexer moves it to 已連結
    let linked: boolean
    try {
      const doc = await notes.acquire(sourceId)
      try {
        linked = linkMention(doc.getXmlFragment('content'), title, noteId)
      } finally {
        notes.release(sourceId)
      }
    } catch {
      linked = false
    }
    if (!linked)
      setHiddenIds((s) => {
        const next = new Set(s)
        next.delete(sourceId)
        return next
      })
  }

  const blank = isBlank(title)
  const hits = !blank && res?.base === base ? res.hits : []
  return {
    mentions: hits.filter((h) => !hidden.has(h.noteId)),
    convert,
    /** True once results for the current title exist (immediately for a blank title). */
    loaded: blank || res?.full === full,
  }
}
