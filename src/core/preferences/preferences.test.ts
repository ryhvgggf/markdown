import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { DEFAULT_PREFS, Preferences } from './preferences'

let storage: MemoryStorage
const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const open = (s = storage, user?: string) => Preferences.open(s, user, { channelFactory })
beforeEach(() => {
  storage = new MemoryStorage()
})

describe('Preferences', () => {
  it('returns defaults when nothing is stored', async () => {
    const p = await open()
    expect(p.get()).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS).toMatchObject({ accent: '#4F4BC9', sidebarWidth: 256, panelWidth: 300, backgroundBlur: 0.5, backgroundDim: 0.15 })
  })

  it('persists across reopen, only given keys', async () => {
    const p = await open()
    p.set({ accent: '#1F63D6', fontSize: 'large' })
    await new Promise((r) => setTimeout(r, 10))
    p.close()
    const p2 = await open()
    expect(p2.get()).toEqual({ ...DEFAULT_PREFS, accent: '#1F63D6', fontSize: 'large' })
  })

  it('clamps widths and blur/dim', async () => {
    const p = await open()
    p.set({ sidebarWidth: 500, panelWidth: 100, backgroundBlur: 2, backgroundDim: -1 })
    expect(p.get()).toMatchObject({ sidebarWidth: 360, panelWidth: 280, backgroundBlur: 1, backgroundDim: 0 })
    p.set({ sidebarWidth: 100, panelWidth: 999 })
    expect(p.get()).toMatchObject({ sidebarWidth: 220, panelWidth: 420 })
  })

  it('falls back to defaults for invalid stored values', async () => {
    const p = await open()
    const m = p.doc.getMap('prefs')
    m.set('fontSize', 'huge')
    m.set('sidebarWidth', 'wide')
    m.set('bogus', 1)
    expect(p.get().fontSize).toBe('standard')
    expect(p.get().sidebarWidth).toBe(256)
  })

  it('observe fires with merged prefs and can unsubscribe', async () => {
    const p = await open()
    const cb = vi.fn()
    const off = p.observe(cb)
    p.set({ railMode: 'pinned' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].railMode).toBe('pinned')
    off()
    p.set({ railMode: 'hover' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('isolates users', async () => {
    const a = await open(storage, 'a')
    a.set({ accent: '#C2362B' })
    await new Promise((r) => setTimeout(r, 10))
    const b = await open(storage, 'b')
    expect(b.get().accent).toBe(DEFAULT_PREFS.accent)
  })
})
