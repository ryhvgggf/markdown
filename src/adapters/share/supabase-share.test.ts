import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseShare } from './supabase-share'
import { ShareError } from './types'

type Result = { data?: unknown; error?: { message: string; code?: string } | null }

/** Records every builder call; each awaited chain resolves to the next queued result. */
function fakeClient(results: Result[]) {
  const calls: unknown[][] = []
  const next = () => results.shift() ?? { data: null, error: null }
  const chain = (): unknown => {
    const c: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'in', 'order'])
      c[m] = (...args: unknown[]) => (calls.push([m, ...args]), c)
    c.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, fail)
    return c
  }
  const client = {
    from: (table: string) => (calls.push(['from', table]), chain()),
    rpc: async (fn: string, args: unknown) => (calls.push(['rpc', fn, args]), next()),
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('SupabaseShare', () => {
  it('create sends hex bytea and the owner', async () => {
    const { client, calls } = fakeClient([{ error: null }])
    await new SupabaseShare(client).create({ id: 's1', vaultId: 'v1', noteId: 'n1', userId: 'u1', wrappedKey: 'w', ciphertext: new Uint8Array([0, 255]) })
    expect(calls).toEqual([
      ['from', 'share_links'],
      ['insert', { id: 's1', vault_id: 'v1', note_id: 'n1', user_id: 'u1', wrapped_key: 'w', ciphertext: '\\x00ff' }],
    ])
  })

  it('update reports not-found when no row matched', async () => {
    const { client } = fakeClient([{ data: [], error: null }])
    await expect(new SupabaseShare(client).update('s1', new Uint8Array([1]))).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('getPublic goes through the RPC and decodes bytea; null when missing', async () => {
    const { client, calls } = fakeClient([{ data: [{ ciphertext: '\\x0102' }], error: null }, { data: [], error: null }])
    const share = new SupabaseShare(client)
    expect(await share.getPublic('s1')).toEqual(new Uint8Array([1, 2]))
    expect(calls[0]).toEqual(['rpc', 'get_shared_snapshot', { p_id: 's1' }])
    expect(await share.getPublic('s2')).toBeNull()
  })

  it('listForNote maps rows', async () => {
    const { client } = fakeClient([
      { data: [{ id: 's1', vault_id: 'v1', note_id: 'n1', wrapped_key: 'w', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }], error: null },
    ])
    expect(await new SupabaseShare(client).listForNote('v1', 'n1')).toEqual([
      { id: 's1', vaultId: 'v1', noteId: 'n1', wrappedKey: 'w', createdAt: Date.parse('2026-01-01T00:00:00Z'), updatedAt: Date.parse('2026-01-02T00:00:00Z') },
    ])
  })

  it('wraps server errors', async () => {
    const { client } = fakeClient([{ error: { message: 'boom' } }])
    await expect(new SupabaseShare(client).remove('s1')).rejects.toBeInstanceOf(ShareError)
  })

  it('a request without a valid sign-in (RLS or JWT error) is reported as signed-out, other failures as unknown', async () => {
    const run = async (code: string) => {
      const { client } = fakeClient([{ error: { message: 'x', code } }])
      return new SupabaseShare(client).create({ id: 's1', vaultId: 'v1', noteId: 'n1', userId: 'u1', wrappedKey: 'w', ciphertext: new Uint8Array([1]) }).catch((e: ShareError) => e.kind)
    }
    expect(await run('42501')).toBe('signed-out')
    expect(await run('PGRST301')).toBe('signed-out')
    expect(await run('23505')).toBe('unknown')
  })

  it('removeForNotes deletes by vault and note ids, and does nothing for an empty list', async () => {
    const { client, calls } = fakeClient([{ error: null }])
    const s = new SupabaseShare(client)
    await s.removeForNotes('v1', [])
    expect(calls).toEqual([])
    await s.removeForNotes('v1', ['a', 'b'])
    expect(calls).toEqual([['from', 'share_links'], ['delete'], ['eq', 'vault_id', 'v1'], ['in', 'note_id', ['a', 'b']]])
  })
})
