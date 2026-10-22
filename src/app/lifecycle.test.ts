import { describe, expect, it, vi } from 'vitest'
import type { AppServices } from './bootstrap'
import { startPageLifecycle } from './lifecycle'

function fake(failing = false) {
  return {
    maintenance: { runStartup: vi.fn(async () => ({ unreadable: [] })), watchDuplicateTitles: vi.fn(() => () => {}) },
    indexer: { flushPending: vi.fn(async () => {}) },
    notes: { flushAll: vi.fn(async () => {}), retryAll: vi.fn(), hasFailedWrites: () => failing },
    stashUnsaved: vi.fn(),
    vault: { flushWrites: vi.fn(async () => {}), retryWrites: vi.fn(), hasFailedWrites: () => false },
  }
}

describe('startPageLifecycle', () => {
  it('runs startup maintenance after render, not synchronously', async () => {
    const s = fake()
    const stop = startPageLifecycle(s as unknown as AppServices)
    expect(s.maintenance.runStartup).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(s.maintenance.runStartup).toHaveBeenCalledTimes(1))
    stop()
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

  it('warns before unload only while a write is failing', () => {
    for (const failing of [false, true]) {
      const stop = startPageLifecycle(fake(failing) as unknown as AppServices)
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(failing)
      stop()
    }
  })
})
