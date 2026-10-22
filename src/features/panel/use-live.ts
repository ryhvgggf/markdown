import { useEffect, useState, type DependencyList } from 'react'
import { liveQuery } from 'dexie'

const sameDeps = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/**
 * Re-renders with the query result whenever the underlying Dexie tables change.
 * Returns `undefined` until the first emission for the current `deps` (never a previous query's value).
 */
export function useLive<T>(query: () => Promise<T> | T, deps: DependencyList): T | undefined {
  const [state, setState] = useState<{ deps: DependencyList; value: T } | null>(null)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (value) => setState({ deps, value }),
      // A failed read leaves the data "not loaded" (callers render nothing) rather than crashing the card.
      error: () => setState(null),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state && sameDeps(state.deps, deps) ? state.value : undefined
}
