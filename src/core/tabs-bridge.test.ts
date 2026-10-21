import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { TAB_ORIGIN, connectTabs } from './tabs-bridge'

type Listener = (ev: MessageEvent) => void

/** In-memory BroadcastChannel: async delivery to all other same-name instances, never the sender. */
class FakeChannel {
  static all = new Set<FakeChannel>()
  onmessage: Listener | null = null
  closed = false
  constructor(public name: string) {
    FakeChannel.all.add(this)
  }
  postMessage(data: unknown) {
    if (this.closed) throw new Error('closed')
    for (const c of FakeChannel.all) {
      if (c === this || c.name !== this.name) continue
      queueMicrotask(() => {
        if (!c.closed) c.onmessage?.({ data } as MessageEvent)
      })
    }
  }
  close() {
    this.closed = true
    FakeChannel.all.delete(this)
  }
}
const factory = (name: string) => new FakeChannel(name) as unknown as BroadcastChannel
const settle = () => new Promise((r) => setTimeout(r, 10))

describe('connectTabs', () => {
  it('propagates local edits to the other tab', async () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const offA = connectTabs(a, 'n1', factory)
    const offB = connectTabs(b, 'n1', factory)
    await settle()
    a.getText('t').insert(0, 'hello')
    await settle()
    expect(b.getText('t').toString()).toBe('hello')
    offA()
    offB()
  })

  it('applies remote updates with TAB_ORIGIN and does not rebroadcast', async () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const origins: unknown[] = []
    b.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    const offA = connectTabs(a, 'n2', factory)
    const offB = connectTabs(b, 'n2', factory)
    await settle()
    let aUpdates = 0
    a.getText('t').insert(0, 'x')
    a.on('update', () => aUpdates++)
    await settle()
    expect(origins).toEqual([TAB_ORIGIN])
    expect(aUpdates).toBe(0)
    offA()
    offB()
  })

  it('syncs existing state when a new tab joins (both directions)', async () => {
    const a = new Y.Doc()
    a.getText('t').insert(0, 'old')
    const offA = connectTabs(a, 'n3', factory)
    const b = new Y.Doc()
    b.getText('u').insert(0, 'mine')
    const offB = connectTabs(b, 'n3', factory)
    await settle()
    expect(b.getText('t').toString()).toBe('old')
    expect(a.getText('u').toString()).toBe('mine')
    offA()
    offB()
  })

  it('stops sending and receiving after disconnect', async () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const offA = connectTabs(a, 'n4', factory)
    const offB = connectTabs(b, 'n4', factory)
    await settle()
    offB()
    a.getText('t').insert(0, 'z')
    await settle()
    expect(b.getText('t').toString()).toBe('')
    b.getText('t').insert(0, 'q')
    await settle()
    expect(a.getText('t').toString()).toBe('z')
    offA()
  })

  it('isolates different docIds', async () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const offA = connectTabs(a, 'x', factory)
    const offB = connectTabs(b, 'y', factory)
    a.getText('t').insert(0, 'a')
    await settle()
    expect(b.getText('t').toString()).toBe('')
    offA()
    offB()
  })
})
