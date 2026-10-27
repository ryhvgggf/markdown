import { afterEach, describe, expect, it, vi } from 'vitest'
import { onIdle } from './idle'

afterEach(() => vi.unstubAllGlobals())

describe('onIdle', () => {
  it('uses requestIdleCallback with a timeout when available, and cancels', () => {
    const ric = vi.fn((...args: [IdleRequestCallback, IdleRequestOptions?]) => (void args, 7))
    const cic = vi.fn()
    vi.stubGlobal('requestIdleCallback', ric)
    vi.stubGlobal('cancelIdleCallback', cic)
    const fn = vi.fn()
    const cancel = onIdle(fn, 500)
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 })
    ric.mock.calls[0][0]({ didTimeout: false, timeRemaining: () => 10 })
    expect(fn).toHaveBeenCalledTimes(1)
    cancel()
    expect(cic).toHaveBeenCalledWith(7)
  })

  it('falls back to a later task, never synchronously', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const fn = vi.fn()
    onIdle(fn)
    expect(fn).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 5))
    expect(fn).toHaveBeenCalledTimes(1)
    const g = vi.fn()
    onIdle(g)()
    await new Promise((r) => setTimeout(r, 5))
    expect(g).not.toHaveBeenCalled()
  })
})
