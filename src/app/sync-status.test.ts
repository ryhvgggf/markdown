import { afterEach, describe, expect, it } from 'vitest'
import { SyncError } from '@/adapters/sync/types'
import { createSyncStatus, reportingProgress, type SyncStatusStore } from './sync-status'

const stores: SyncStatusStore[] = []
afterEach(() => stores.splice(0).forEach((s) => s.close()))
const mk = (channelFactory?: (n: string) => BroadcastChannel) => {
  const s = createSyncStatus({ channelFactory })
  stores.push(s)
  return s
}
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('sync status', () => {
  it('off → syncing → synced, following pending', () => {
    const s = mk()
    expect(s.get().state).toBe('off')
    const r = s.start()
    expect(s.get().state).toBe('off') // another tab may be the one syncing; this one waits for its first report
    r.pending(true)
    expect(s.get().state).toBe('syncing')
    r.pending(false)
    expect(s.get().state).toBe('synced')
    r.pending(true)
    expect(s.get().state).toBe('syncing')
    s.stop()
    expect(s.get()).toEqual({ state: 'off', issues: [] })
  })

  it('classifies errors, keeps one issue per note and kind, and get() is stable between changes', () => {
    const s = mk()
    const r = s.start()
    r.error(new SyncError('offline'), 'n1')
    r.error(new SyncError('offline'), 'n1')
    r.error(new SyncError('conflict'), 'n2')
    r.error(new Error('boom'), 'n3')
    expect(s.get().state).toBe('error')
    expect(s.get().issues).toEqual([
      { docId: 'n1', kind: 'offline' },
      { docId: 'n2', kind: 'conflict' },
      { docId: 'n3', kind: 'failed' },
    ])
    expect(s.get()).toBe(s.get())
  })

  it('offline issues clear once pending pushes go through; others stay until dismissed', () => {
    const s = mk()
    const r = s.start()
    r.pending(true)
    r.error(new SyncError('offline'), 'n1')
    r.error(new SyncError('conflict'), 'n2')
    r.pending(false)
    expect(s.get()).toEqual({ state: 'error', issues: [{ docId: 'n2', kind: 'conflict' }] })
    s.dismiss()
    expect(s.get()).toEqual({ state: 'synced', issues: [] })
  })

  it('notifies subscribers', () => {
    const s = mk()
    let n = 0
    s.subscribe(() => n++)
    const r = s.start()
    r.pending(true)
    r.pending(false)
    expect(n).toBe(2)
  })

  it('reports from a stopped run are ignored', () => {
    const s = mk()
    const r = s.start()
    s.stop()
    r.error(new SyncError('offline'), 'n1')
    expect(s.get().state).toBe('off')
  })

  it('other tabs see the sync tab’s status, including one opened later', async () => {
    const a = mk((n) => new BroadcastChannel(n))
    const r = a.start()
    r.error(new SyncError('conflict'), 'n2')
    await tick()
    const b = mk((n) => new BroadcastChannel(n))
    await tick()
    expect(b.get()).toEqual(a.get())
    b.dismiss()
    await tick()
    expect(a.get().issues).toEqual([])
  })
})

describe('reportingProgress', () => {
  it('reports syncing while the manager starts and has pending work, synced once it is done', async () => {
    const s = mk()
    let pending = true
    const m = reportingProgress({ start: async () => {}, close: async () => {}, hasPending: () => pending }, s.start(), 5)
    const started = m.start()
    expect(s.get().state).toBe('syncing')
    await started
    expect(s.get().state).toBe('syncing')
    pending = false
    await new Promise((r) => setTimeout(r, 30))
    expect(s.get().state).toBe('synced')
    await m.close()
  })

  it('reports which notes are still coming down while start() runs, and none afterwards', async () => {
    const s = mk()
    let loading = ['a', 'b']
    let finish!: () => void
    const m = reportingProgress(
      { start: () => new Promise<void>((r) => (finish = r)), close: async () => {}, hasPending: () => false, loadingNoteIds: () => loading },
      s.start(),
      5,
    )
    const started = m.start()
    await new Promise((r) => setTimeout(r, 400))
    expect(s.get().loading).toEqual(['a', 'b'])
    loading = ['b']
    await new Promise((r) => setTimeout(r, 400))
    expect(s.get().loading).toEqual(['b'])
    finish()
    await started
    expect(s.get().loading).toBeUndefined()
    await m.close()
  })
})
