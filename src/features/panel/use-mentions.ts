import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { linkMention } from '@/core/links/link-mention'
import type { SearchHit } from '@/core/search/search'

const DEBOUNCE_MS = 300

/** Notes whose body mentions `title` but do not link to `noteId`, plus the 轉為連結 action. */
export function useMentions(noteId: string, title: string, linkedIds: string[]) {
  const { search, notes } = useServices()
  const [hits, setHits] = useState<SearchHit[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const key = linkedIds.slice().sort().join(',')

  useEffect(() => {
    const t = title.trim()
    if (!t || t === '未命名') return
    let cancelled = false
    const timer = setTimeout(() => {
      search
        .mentions(t, [noteId, ...(key ? key.split(',') : [])])
        .then((h) => !cancelled && setHits(h), () => !cancelled && setHits([]))
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, noteId, title, key])

  const unhide = (id: string) =>
    setHidden((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })

  const convert = async (sourceId: string) => {
    setHidden((s) => new Set(s).add(sourceId)) // optimistic: the indexer moves it to 已連結
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
    if (!linked) unhide(sourceId)
  }

  const blank = !title.trim() || title.trim() === '未命名'
  return { mentions: blank ? [] : hits.filter((h) => !hidden.has(h.noteId)), convert }
}
