import { describe, expect, it, vi } from 'vitest'
import { createUiStore } from './ui-store'

describe('ui store', () => {
  it('togglePanel twice returns to none', () => {
    const s = createUiStore()
    s.getState().togglePanel('backlinks')
    expect(s.getState().panel).toBe('backlinks')
    s.getState().togglePanel('backlinks')
    expect(s.getState().panel).toBe('none')
  })
  it('togglePanel switches between panels', () => {
    const s = createUiStore()
    s.getState().togglePanel('outline')
    s.getState().togglePanel('backlinks')
    expect(s.getState().panel).toBe('backlinks')
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
