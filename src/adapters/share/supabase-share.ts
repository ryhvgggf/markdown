import type { SupabaseClient } from '@supabase/supabase-js'
import { bytesToPgHex, pgHexToBytes } from '@/adapters/sync/supabase-sync'
import { ShareError, type NewShare, type ShareAdapter, type ShareRecord } from './types'

type Row = { id: string; vault_id: string; note_id: string; wrapped_key: string; created_at: string; updated_at: string }

const toError = (e: { message: string; code?: string }) => new ShareError('unknown', e.message, { cause: e })

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

  async removeForNote(vaultId: string, noteId: string): Promise<void> {
    const { error } = await this.client.from('share_links').delete().eq('vault_id', vaultId).eq('note_id', noteId)
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
