import { describe, expect, it, vi } from 'vitest'
import { runAsSyncLeader } from './sync-leader'

/** A minimal exclusive Web Locks stand-in. */
function fakeLocks() {
  let tail: Promise<void> = Promise.resolve()
  return {
    request(_name: string, opts: { signal: AbortSignal }, cb: () => Promise<void>) {
      const prev = tail
      // like the real API: a queued request rejects as soon as its signal aborts
      const aborted = new Promise<never>((_, reject) =>
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      )
      const mine = Promise.race([prev, aborted]).then(() => cb())
      tail = mine.catch(() => {})
      return mine
    },
  }
}

const manager = () => ({ start: vi.fn(async () => {}), close: vi.fn(async () => {}) })

describe('runAsSyncLeader', () => {
  it('runs in one tab at a time; the next takes over when the first stops', async () => {
    const locks = fakeLocks()
    const a = manager()
    const b = manager()
    const ha = runAsSyncLeader(() => a, { locks })
    const hb = runAsSyncLeader(() => b, { locks })
    await vi.waitFor(() => expect(a.start).toHaveBeenCalled())
    expect(b.start).not.toHaveBeenCalled()
    await ha.stop()
    expect(a.close).toHaveBeenCalled()
    await vi.waitFor(() => expect(b.start).toHaveBeenCalled())
    await hb.stop()
    expect(b.close).toHaveBeenCalled()
  })

  it('a waiting tab that stops never starts', async () => {
    const locks = fakeLocks()
    const a = manager()
    const b = manager()
    const ha = runAsSyncLeader(() => a, { locks })
    const hb = runAsSyncLeader(() => b, { locks })
    await hb.stop()
    await ha.stop()
    expect(b.start).not.toHaveBeenCalled()
  })

  it('without Web Locks it just runs, and reports a failing start', async () => {
    const onError = vi.fn()
    const bad = { start: vi.fn(async () => Promise.reject(new Error('offline'))), close: vi.fn(async () => {}) }
    const h = runAsSyncLeader(() => bad, { locks: null, onError })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    await h.stop()
    expect(bad.close).toHaveBeenCalled()
  })
})
