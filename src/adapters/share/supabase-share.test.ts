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
    for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'in', 'is', 'order'])
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

  it('update goes through update_share_snapshot (guarded on the password salt) and passes its status through', async () => {
    const { client, calls } = fakeClient([{ data: 'ok' }, { data: 'not-found' }, { data: 'changed' }, { data: 'nonsense' }])
    const share = new SupabaseShare(client)
    expect(await share.update('s1', new Uint8Array([1]), null)).toBe('ok')
    expect(calls).toEqual([['rpc', 'update_share_snapshot', { p_id: 's1', p_ciphertext: '\\x01', p_expected_salt: null }]])
    expect(await share.update('s1', new Uint8Array([1]), 'salt')).toBe('not-found')
    expect(await share.update('s1', new Uint8Array([1]), 'salt')).toBe('changed')
    await expect(share.update('s1', new Uint8Array([1]), null)).rejects.toBeInstanceOf(ShareError)
  })

  it('setPassword sends ciphertext, every password field and both guards to set_share_password; null clears them', async () => {
    const { client, calls } = fakeClient([{ data: 'ok' }, { data: 'ok' }])
    const share = new SupabaseShare(client)
    const hash = new Uint8Array([0xee])
    await share.setPassword('s1', new Uint8Array([2]), { saltB64: 'c2FsdA==', iterations: 600000, verifier: new Uint8Array([0xab]), pwKey: 'pk' }, null, hash)
    expect(calls[0]).toEqual([
      'rpc',
      'set_share_password',
      { p_id: 's1', p_ciphertext: '\\x02', p_salt: 'c2FsdA==', p_iterations: 600000, p_verifier: '\\xab', p_key: 'pk', p_expected_salt: null, p_expected_hash: '\\xee' },
    ])
    await share.setPassword('s1', new Uint8Array([3]), null, 'c2FsdA==', hash)
    expect(calls[1]).toEqual([
      'rpc',
      'set_share_password',
      { p_id: 's1', p_ciphertext: '\\x03', p_salt: null, p_iterations: null, p_verifier: null, p_key: null, p_expected_salt: 'c2FsdA==', p_expected_hash: '\\xee' },
    ])
  })

  it('getPublic maps the three statuses and never expects ciphertext for expired or protected links', async () => {
    const { client } = fakeClient([
      { data: [{ status: 'expired', ciphertext: null, pw_salt: null, pw_iterations: null }] },
      { data: [{ status: 'password', ciphertext: null, pw_salt: 'c2FsdA==', pw_iterations: 600000 }] },
      { data: [{ status: 'weird', ciphertext: null, pw_salt: null, pw_iterations: null }] },
    ])
    const share = new SupabaseShare(client)
    expect(await share.getPublic('s1')).toEqual({ status: 'expired' })
    expect(await share.getPublic('s1')).toEqual({ status: 'password', saltB64: 'c2FsdA==', iterations: 600000 })
    await expect(share.getPublic('s1')).rejects.toBeInstanceOf(ShareError)
  })

  it('openProtected sends the proof as bytea and maps the result', async () => {
    const { client, calls } = fakeClient([
      { data: [{ status: 'ok', ciphertext: '\\x0102', pw_salt: 'c2FsdA==' }] },
      { data: [{ status: 'wrong', ciphertext: null, pw_salt: null }] },
      { data: [] },
    ])
    const share = new SupabaseShare(client)
    expect(await share.openProtected('s1', new Uint8Array([9]))).toEqual({ status: 'ok', ciphertext: new Uint8Array([1, 2]), passwordSalt: 'c2FsdA==' })
    expect(calls[0]).toEqual(['rpc', 'open_protected_snapshot', { p_id: 's1', p_proof: '\\x09' }])
    expect(await share.openProtected('s1', new Uint8Array([9]))).toEqual({ status: 'wrong' })
    expect(await share.openProtected('s1', new Uint8Array([9]))).toBeNull()
  })

  it('setExpiry goes through the server-clock RPC; no row means not-found', async () => {
    const { client, calls } = fakeClient([{ data: [{ expires_at: '2026-11-05T00:00:00Z' }] }, { data: [{ expires_at: null }] }, { data: [] }])
    const share = new SupabaseShare(client)
    expect(await share.setExpiry('s1', 86400)).toEqual({ expiresAt: Date.parse('2026-11-05T00:00:00Z') })
    expect(calls[0]).toEqual(['rpc', 'set_share_expiry', { p_id: 's1', p_seconds: 86400 }])
    expect(await share.setExpiry('s1', null)).toEqual({ expiresAt: null })
    expect(await share.setExpiry('s1', 86400)).toBe('not-found')
  })

  it('renew is one RPC and passes its status through', async () => {
    const { client, calls } = fakeClient([{ data: 'ok' }, { data: 'changed' }, { data: 'nonsense' }])
    const share = new SupabaseShare(client)
    const next = { id: 's2', wrappedKey: 'w', ciphertext: new Uint8Array([1]), verifier: null, pwKey: null }
    const hash = new Uint8Array([0xee])
    expect(await share.renew('s1', next, null, hash)).toBe('ok')
    expect(calls[0]).toEqual([
      'rpc',
      'renew_share_link',
      { p_old: 's1', p_new: 's2', p_wrapped_key: 'w', p_ciphertext: '\\x01', p_pw_verifier: null, p_pw_key: null, p_expected_salt: null, p_expected_hash: '\\xee' },
    ])
    expect(await share.renew('s1', next, 'x', hash)).toBe('changed')
    await expect(share.renew('s1', next, null, hash)).rejects.toBeInstanceOf(ShareError)
  })

  it('getOwn returns the record and the ciphertext; listForVault maps password and expiry', async () => {
    const row = {
      id: 's1', vault_id: 'v1', note_id: 'n1', wrapped_key: 'w', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      expires_at: '2026-02-01T00:00:00Z', pw_salt: 'c2FsdA==', pw_iterations: 600000, pw_key: 'pk',
    }
    const { client } = fakeClient([{ data: [{ ...row, ciphertext: '\\x05' }] }, { data: [row] }, { data: [] }])
    const share = new SupabaseShare(client)
    const own = await share.getOwn('s1')
    expect(own?.ciphertext).toEqual(new Uint8Array([5]))
    expect(own?.record).toMatchObject({ expiresAt: Date.parse('2026-02-01T00:00:00Z'), password: { saltB64: 'c2FsdA==', iterations: 600000, pwKey: 'pk' } })
    expect((await share.listForVault('v1'))[0].password?.pwKey).toBe('pk')
    expect(await share.getOwn('s9')).toBeNull()
  })

  it('getPublic goes through the RPC and decodes bytea; null when missing', async () => {
    const { client, calls } = fakeClient([{ data: [{ status: 'ok', ciphertext: '\\x0102', pw_salt: null, pw_iterations: null }], error: null }, { data: [], error: null }])
    const share = new SupabaseShare(client)
    expect(await share.getPublic('s1')).toEqual({ status: 'ok', ciphertext: new Uint8Array([1, 2]) })
    expect(calls[0]).toEqual(['rpc', 'get_shared_snapshot', { p_id: 's1' }])
    expect(await share.getPublic('s2')).toBeNull()
  })

  it('listForNote maps rows and asks only for single-note links', async () => {
    const { client, calls } = fakeClient([
      { data: [{ id: 's1', vault_id: 'v1', note_id: 'n1', wrapped_key: 'w', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', expires_at: null, pw_salt: null, pw_iterations: null, pw_key: null }], error: null },
    ])
    expect(await new SupabaseShare(client).listForNote('v1', 'n1')).toEqual([
      { id: 's1', vaultId: 'v1', noteId: 'n1', noteIds: null, wrappedKey: 'w', createdAt: Date.parse('2026-01-01T00:00:00Z'), updatedAt: Date.parse('2026-01-02T00:00:00Z'), expiresAt: null, password: null },
    ])
    expect(calls).toContainEqual(['is', 'note_ids', null])
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

  it('removeForNotes goes through remove_shares_for_notes (multi-note links included), and does nothing for an empty list', async () => {
    const { client, calls } = fakeClient([{ error: null }])
    const s = new SupabaseShare(client)
    await s.removeForNotes('v1', [])
    expect(calls).toEqual([])
    await s.removeForNotes('v1', ['a', 'b'])
    expect(calls).toEqual([['rpc', 'remove_shares_for_notes', { p_vault: 'v1', p_note_ids: ['a', 'b'] }]])
  })

  it('create sends note_ids only for a multi-note link', async () => {
    const { client, calls } = fakeClient([{ error: null }])
    await new SupabaseShare(client).create({ id: 's1', vaultId: 'v1', noteId: 'n1', noteIds: ['n1', 'n2'], userId: 'u1', wrappedKey: 'w', ciphertext: new Uint8Array([1]) })
    expect(calls[1]).toEqual(['insert', expect.objectContaining({ note_id: 'n1', note_ids: ['n1', 'n2'] })])
  })

  it('setNotes goes through set_share_notes with both guards and passes its status through; rows map note_ids', async () => {
    const row = {
      id: 's1', vault_id: 'v1', note_id: 'n1', note_ids: ['n1', 'n2'], wrapped_key: 'w', created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z', expires_at: null, pw_salt: null, pw_iterations: null, pw_key: null,
    }
    const { client, calls } = fakeClient([{ data: 'ok' }, { data: 'changed' }, { data: [row] }])
    const share = new SupabaseShare(client)
    expect(await share.setNotes('s1', ['n2', 'n1'], new Uint8Array([7]), 'salt', new Uint8Array([9]))).toBe('ok')
    expect(calls[0]).toEqual([
      'rpc',
      'set_share_notes',
      { p_id: 's1', p_note_ids: ['n2', 'n1'], p_ciphertext: '\\x07', p_expected_salt: 'salt', p_expected_hash: '\\x09' },
    ])
    expect(await share.setNotes('s1', ['n1'], new Uint8Array([7]), null, new Uint8Array([9]))).toBe('changed')
    expect((await share.listForVault('v1'))[0].noteIds).toEqual(['n1', 'n2'])
  })
})
