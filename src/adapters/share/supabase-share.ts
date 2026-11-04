import type { SupabaseClient } from '@supabase/supabase-js'
import { bytesToPgHex, pgHexToBytes } from '@/adapters/sync/supabase-sync'
import { ShareError, type NewShare, type ShareAdapter, type ShareRecord } from './types'

type Row = { id: string; vault_id: string; note_id: string; wrapped_key: string; created_at: string; updated_at: string }

/** Postgres 42501 (row-level security) and PostgREST's JWT errors: the request had no valid sign-in. */
const NOT_SIGNED_IN = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303'])
const toError = (e: { message: string; code?: string }) => new ShareError(e.code && NOT_SIGNED_IN.has(e.code) ? 'signed-out' : 'unknown', e.message, { cause: e })

/**
 * `ShareAdapter` on Supabase's `share_links` table (migration 0004). The owner reads and writes through RLS
 * (own rows only). Viewers are anonymous and never select from the table — they call `get_shared_snapshot`,
 * which returns one row's ciphertext by id, so links cannot be listed.
 */
export class SupabaseShare implements ShareAdapter {
  constructor(private client: SupabaseClient) {}

  async create(s: NewShare): Promise<void> {
    const { error } = await this.client.from('share_links').insert({
      id: s.id,
      vault_id: s.vaultId,
      note_id: s.noteId,
      user_id: s.userId,
      wrapped_key: s.wrappedKey,
      ciphertext: bytesToPgHex(s.ciphertext),
    })
    if (error) throw toError(error)
  }

  async update(id: string, ciphertext: Uint8Array): Promise<void> {
    const { data, error } = await this.client.from('share_links').update({ ciphertext: bytesToPgHex(ciphertext) }).eq('id', id).select('id')
    if (error) throw toError(error)
    if ((data ?? []).length === 0) throw new ShareError('not-found')
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('share_links').delete().eq('id', id)
    if (error) throw toError(error)
  }

  async removeForNotes(vaultId: string, noteIds: string[]): Promise<void> {
    if (!noteIds.length) return
    const { error } = await this.client.from('share_links').delete().eq('vault_id', vaultId).in('note_id', noteIds)
    if (error) throw toError(error)
  }

  async listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]> {
    const { data, error } = await this.client
      .from('share_links')
      .select('id, vault_id, note_id, wrapped_key, created_at, updated_at')
      .eq('vault_id', vaultId)
      .eq('note_id', noteId)
      .order('created_at', { ascending: false })
    if (error) throw toError(error)
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      vaultId: r.vault_id,
      noteId: r.note_id,
      wrappedKey: r.wrapped_key,
      createdAt: Date.parse(r.created_at),
      updatedAt: Date.parse(r.updated_at),
    }))
  }

  async getPublic(id: string): Promise<Uint8Array | null> {
    const { data, error } = await this.client.rpc('get_shared_snapshot', { p_id: id })
    if (error) throw toError(error)
    const row = ((data ?? []) as Array<{ ciphertext: string }>)[0]
    return row ? pgHexToBytes(row.ciphertext) : null
  }
}
