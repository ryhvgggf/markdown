import { useEffect, useState, type DependencyList } from 'react'
import { liveQuery } from 'dexie'

/** Re-renders with the query result whenever the underlying Dexie tables change. */
export function useLive<T>(query: () => Promise<T> | T, deps: DependencyList, initial: T): T {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => undefined })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
