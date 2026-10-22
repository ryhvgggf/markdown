import { afterEach, describe, expect, it } from 'vitest'
import { clearOwnStashes, clearStashed, readStashed, stashUpdate } from './unsaved-stash'

afterEach(() => localStorage.clear())

describe('unsaved stash', () => {
  it('round-trips updates and clears every tab entry of a deleted doc', () => {
    stashUpdate('n1', new Uint8Array([1, 2, 3]))
    localStorage.setItem('notes-v2.unsaved:otherTab:n1', btoa('\x04'))
    expect(readStashed().map((s) => s.docId)).toEqual(['n1', 'n1'])
    clearStashed('n1')
    expect(readStashed()).toEqual([])
  })

  it('clearOwnStashes leaves stashes written by other tabs', () => {
    stashUpdate('n1', new Uint8Array([1]))
    localStorage.setItem('notes-v2.unsaved:otherTab:n2', btoa('\x04'))
    clearOwnStashes()
    expect(readStashed().map((s) => s.docId)).toEqual(['n2'])
  })
})
