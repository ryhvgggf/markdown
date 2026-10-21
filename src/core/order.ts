import { generateKeyBetween } from 'fractional-indexing'

/** Returns an order key placing an item at `index` among siblings (whose keys are `siblingOrders`). */
export function orderForIndex(siblingOrders: string[], index: number): string {
  const sorted = [...siblingOrders].sort()
  const i = Math.max(0, Math.min(index, sorted.length))
  return generateKeyBetween(sorted[i - 1] ?? null, sorted[i] ?? null)
}
