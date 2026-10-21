import { generateKeyBetween } from 'fractional-indexing'

/** Returns an order key placing an item at `index` among siblings (whose keys are `siblingOrders`). */
export function orderForIndex(siblingOrders: string[], index: number): string {
  const sorted = [...siblingOrders].sort()
  const i = Math.max(0, Math.min(index, sorted.length))
  const prev = sorted[i - 1] ?? null
  const next = sorted[i] ?? null
  if (prev !== null && next !== null && prev >= next) {
    // Duplicate keys (e.g. from concurrent inserts): go after the run of equal keys.
    const greater = sorted.find((k) => k > prev) ?? null
    return generateKeyBetween(prev, greater)
  }
  return generateKeyBetween(prev, next)
}
