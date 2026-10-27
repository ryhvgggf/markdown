import { describe, expect, it, vi } from 'vitest'
import { createUiStore } from './ui-store'

describe('ui store', () => {
  it('backlinks panel: toggle, pin, and close (an unpinned close is ignored while pinned)', () => {
    const s = createUiStore()
    s.getState().toggleBacklinks()
    expect(s.getState().backlinksOpen).toBe(true)
    s.getState().toggleBacklinks()
    expect(s.getState().backlinksOpen).toBe(false)
    s.getState().toggleBacklinks()
    s.getState().setBacklinksPinned(true)
    s.getState().closeBacklinks() // e.g. pointer left the panel
    expect(s.getState().backlinksOpen).toBe(true)
    s.getState().closeBacklinks({ force: true }) // × / Esc: closes and unpins
    expect(s.getState()).toMatchObject({ backlinksOpen: false, backlinksPinned: false })
  })
  it('switching notes closes the backlinks panel unless pinned', () => {
    const s = createUiStore()
    s.getState().toggleBacklinks()
    s.getState().openNote('a')
    expect(s.getState().backlinksOpen).toBe(false)
    s.getState().toggleBacklinks()
    s.getState().setBacklinksPinned(true)
    s.getState().openNote('b')
    expect(s.getState().backlinksOpen).toBe(true)
  })
  it('openNote sets highlight, persists, and clearHighlight clears', () => {
    const persist = vi.fn()
    const s = createUiStore({ persistLastNote: persist })
    s.getState().openNote('n1', 'b1')
    expect(s.getState().openNoteId).toBe('n1')
    expect(s.getState().highlightBlockId).toBe('b1')
    expect(persist).toHaveBeenCalledWith('n1')
    s.getState().clearHighlight()
    expect(s.getState().highlightBlockId).toBeNull()
    s.getState().openNote('n2')
    expect(s.getState().highlightBlockId).toBeNull()
  })
})
