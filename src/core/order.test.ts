import { describe, expect, it } from 'vitest'
import { orderForIndex } from './order'

describe('orderForIndex', () => {
  it('inserts at head, middle, tail', () => {
    let orders: string[] = []
    orders = [...orders, orderForIndex(orders, 0)]
    const a = orders[0]
    const tail = orderForIndex(orders, 1)
    const head = orderForIndex(orders, 0)
    expect([head, a, tail].slice().sort()).toEqual([head, a, tail])
    const sorted = [head, a, tail]
    const mid = orderForIndex(sorted, 1)
    expect([head, mid, a, tail].slice().sort()).toEqual([head, mid, a, tail])
    expect(orderForIndex(sorted, 99) > tail).toBe(true)
  })

  it('never throws with duplicate sibling keys', () => {
    const sibs = ['a0', 'a0', 'a1']
    for (let i = 0; i <= 3; i++) {
      const k = orderForIndex(sibs, i)
      expect(typeof k).toBe('string')
      const all = [...sibs, k].sort()
      expect(all.indexOf(k)).toBeGreaterThanOrEqual(0)
    }
    expect(orderForIndex(sibs, 0) < 'a0').toBe(true)
    expect(orderForIndex(sibs, 3) > 'a1').toBe(true)
  })
})
