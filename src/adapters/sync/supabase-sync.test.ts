import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseSync, bytesToPgHex, pgHexToBytes } from './supabase-sync'

/** Like supabase-js: `channel(topic)` hands back the live channel for a topic, and `.on` after `subscribe()` throws. */
function fakeClient() {
  type Cb = (p: unknown) => void
  const channels = new Map<string, { subscribed: boolean; handlers: Array<{ table: string; cb: Cb }> }>()
  const client = {
    channel(topic: string) {
      const ch = channels.get(topic) ?? { subscribed: false, handlers: [] }
      channels.set(topic, ch)
      const api = {
        on(_t: string, f: { table: string }, cb: Cb) {
          if (ch.subscribed) throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`)
          ch.handlers.push({ table: f.table, cb })
          return api
        },
        subscribe() {
          ch.subscribed = true
          return api
        },
        topic,
      }
      return api
    },
    async removeChannel(api: { topic: string }) {
      channels.delete(api.topic)
    },
  }
  const emit = (topic: string, table: string, row: Record<string, string>) =>
    channels.get(topic)?.handlers.filter((h) => h.table === table).forEach((h) => h.cb({ new: row, old: {} }))
  return { client: client as unknown as SupabaseClient, channels, emit }
}

describe('SupabaseSync.subscribe', () => {
  it('several subscribers to one vault share one channel; it closes after the last one leaves', () => {
    const { client, channels, emit } = fakeClient()
    const sync = new SupabaseSync(client)
    const a: string[] = []
    const b: string[] = []
    const offA = sync.subscribe('v1', (c) => a.push(c.docId))
    const offB = sync.subscribe('v1', (c) => b.push(c.docId))
    emit('sync:v1', 'doc_updates', { doc_id: 'd1', device_id: 'x' })
    expect(a).toEqual(['d1'])
    expect(b).toEqual(['d1'])
    offA()
    emit('sync:v1', 'doc_snapshots', { doc_id: 'd2' })
    expect(a).toEqual(['d1'])
    expect(b).toEqual(['d1', 'd2'])
    expect(channels.size).toBe(1)
    offB()
    offB() // twice is harmless
    expect(channels.size).toBe(0)
    // and a later subscriber gets a fresh channel
    const c: string[] = []
    sync.subscribe('v1', (x) => c.push(x.docId))
    emit('sync:v1', 'doc_updates', { doc_id: 'd3', device_id: 'x' })
    expect(c).toEqual(['d3'])
  })
})


describe('bytesToPgHex / pgHexToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37))
    expect(Array.from(pgHexToBytes(bytesToPgHex(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips empty input', () => {
    expect(Array.from(pgHexToBytes(bytesToPgHex(new Uint8Array())))).toEqual([])
  })

  it('produces the `\\x`-prefixed hex format Postgres bytea expects', () => {
    expect(bytesToPgHex(new Uint8Array([0, 255, 16]))).toBe('\\x00ff10')
  })

  it('pgHexToBytes also accepts hex without the \\x prefix', () => {
    expect(Array.from(pgHexToBytes('00ff10'))).toEqual([0, 255, 16])
  })
})
