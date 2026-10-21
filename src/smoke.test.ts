import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2)
  })

  it('provides IndexedDB via fake-indexeddb', () => {
    expect(indexedDB).toBeDefined()
  })
})
