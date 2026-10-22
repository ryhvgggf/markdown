import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '@/app/services-context'

const KEY = 'expandedFolders'

/** Expanded folder ids, persisted in Dexie meta. `loaded` flips once the stored value has been read. */
export function useExpanded() {
  const { db } = useServices()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [loaded, setLoaded] = useState(false)
  const current = useRef<ReadonlySet<string>>(expanded)

  useEffect(() => {
    let cancelled = false
    db.meta
      .get(KEY)
      .then((row) => {
        if (cancelled) return
        const v = row?.value
        if (Array.isArray(v)) current.current = new Set(v.filter((x): x is string => typeof x === 'string'))
        setExpanded(current.current)
        setLoaded(true)
      })
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [db])

  const commit = useCallback(
    (next: Set<string>) => {
      current.current = next
      setExpanded(next)
      void db.meta.put({ key: KEY, value: [...next] }).catch(() => undefined)
    },
    [db],
  )
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(current.current)
      if (!next.delete(id)) next.add(id)
      commit(next)
    },
    [commit],
  )
  const expand = useCallback(
    (ids: string[]) => {
      if (ids.every((id) => current.current.has(id))) return
      commit(new Set([...current.current, ...ids]))
    },
    [commit],
  )
  return { expanded, loaded, toggle, expand }
}
