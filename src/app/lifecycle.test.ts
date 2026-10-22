import { describe, expect, it, vi } from 'vitest'
import type { AppServices } from './bootstrap'
import { MAINTENANCE_DELAY_MS, startPageLifecycle } from './lifecycle'

function fake(failing = false) {
  let emit: (e: unknown) => void = () => {}
  return {
    emitError: (e: unknown) => emit(e),
    storageErrors: { subscribe: (cb: (e: unknown) => void) => ((emit = cb), () => (emit = () => {})) },
    maintenance: { runStartup: vi.fn(async () => ({ unreadable: [] })), watchDuplicateTitles: vi.fn(() => () => {}) },
    indexer: { flushPending: vi.fn(async () => {}) },
    notes: { flushAll: vi.fn(async () => {}), retryAll: vi.fn(), hasFailedWrites: () => failing, hasUnsaved: () => failing },
    clearOwnStash: vi.fn(),
    stashUnsaved: vi.fn(),
    vault: { flushWrites: vi.fn(async () => {}), retryWrites: vi.fn(), hasFailedWrites: () => false, hasPendingWrites: () => false },
  }
}

describe('startPageLifecycle', () => {
  it('runs startup maintenance a while after render, not synchronously', () => {
    vi.useFakeTimers()
    try {
      const s = fake()
      const win = Object.assign(new EventTarget(), { requestIdleCallback: (cb: () => void) => (cb(), 1) })
      const stop = startPageLifecycle(s as unknown as AppServices, win as unknown as Window)
      expect(s.maintenance.runStartup).not.toHaveBeenCalled()
      vi.advanceTimersByTime(MAINTENANCE_DELAY_MS)
      expect(s.maintenance.runStartup).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes index and writes on pagehide and retries when visible or online', () => {
    const s = fake()
    const stop = startPageLifecycle(s as unknown as AppServices)
    window.dispatchEvent(new Event('pagehide'))
    expect(s.stashUnsaved).toHaveBeenCalled()
    expect(s.indexer.flushPending).toHaveBeenCalled()
    expect(s.notes.flushAll).toHaveBeenCalled()
    expect(s.vault.flushWrites).toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    expect(s.notes.retryAll).toHaveBeenCalled()
    expect(s.vault.retryWrites).toHaveBeenCalled()
    stop()
    window.dispatchEvent(new Event('pagehide'))
    expect(s.indexer.flushPending).toHaveBeenCalledTimes(1)
  })

  it('warns before unload only while a write is failing, and only listens after a storage error', () => {
    for (const failing of [false, true]) {
      const f = fake(failing)
      const add = vi.spyOn(window, 'addEventListener')
      const stop = startPageLifecycle(f as unknown as AppServices)
      expect(add.mock.calls.some(([t]) => String(t) === 'beforeunload')).toBe(false)
      f.emitError(new Error('quota'))
      expect(add.mock.calls.some(([t]) => String(t) === 'beforeunload')).toBe(true)
      add.mockRestore()
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(failing)
      stop()
    }
  })

  it('clears its own unload stash once writes are flushed after the page is visible again', async () => {
    const s = fake()
    const stop = startPageLifecycle(s as unknown as AppServices)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(s.clearOwnStash).toHaveBeenCalled())
    stop()
  })
})
