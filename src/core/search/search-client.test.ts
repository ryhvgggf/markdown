import { describe, expect, it, vi } from 'vitest'
import { SearchClient } from './search-client'

function fakeWorker() {
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  return w
}
const make = () => {
  const w = fakeWorker()
  const client = new SearchClient({ createWorker: () => w as unknown as Worker })
  return { w, client }
}

describe('SearchClient', () => {
  it('resolves the matching request on {id, hits}', async () => {
    const { w, client } = make()
    const p = client.search('x')
    const sent = w.postMessage.mock.calls.map((c) => c[0]).find((m) => m.kind === 'search')
    const hits = [{ noteId: 'a', title: 't', field: 'content', snippet: 's', updatedAt: 1 }]
    w.onmessage?.({ data: { id: sent.id, hits } } as MessageEvent)
    await expect(p).resolves.toEqual(hits)
  })

  it('resolves listTags on {id, tags}', async () => {
    const { w, client } = make()
    const p = client.listTags()
    const sent = w.postMessage.mock.calls.map((c) => c[0]).find((m) => m.kind === 'listTags')
    const tags = [{ tag: '採購', count: 2 }]
    w.onmessage?.({ data: { id: sent.id, tags } } as MessageEvent)
    await expect(p).resolves.toEqual(tags)
  })

  it('rejects on {id, error}', async () => {
    const { w, client } = make()
    const p = client.mentions('t', [])
    const sent = w.postMessage.mock.calls.map((c) => c[0]).find((m) => m.kind === 'mentions')
    w.onmessage?.({ data: { id: sent.id, error: 'boom' } } as MessageEvent)
    await expect(p).rejects.toThrow('boom')
  })

  it('onerror rejects all pending and later requests', async () => {
    const { w, client } = make()
    const p1 = client.search('a')
    const p2 = client.mentions('b', [])
    w.onerror?.({ message: 'load failed' } as ErrorEvent)
    await expect(p1).rejects.toThrow(/Search worker failed: load failed/)
    await expect(p2).rejects.toThrow(/Search worker failed/)
    await expect(client.search('c')).rejects.toThrow(/Search worker failed/)
  })

  it('onmessageerror rejects pending', async () => {
    const { w, client } = make()
    const p = client.search('a')
    w.onmessageerror?.()
    await expect(p).rejects.toThrow(/Search worker failed/)
  })

  it('request after dispose rejects immediately; dispose rejects pending', async () => {
    const { w, client } = make()
    const p = client.search('a')
    client.dispose()
    expect(w.terminate).toHaveBeenCalled()
    await expect(p).rejects.toThrow(/disposed/)
    await expect(client.search('b')).rejects.toThrow(/disposed/)
  })
})
