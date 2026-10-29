import type { SupabaseClient } from '@supabase/supabase-js'
import { SyncError, type SyncAdapter } from './types'

/**
 * Real `SyncAdapter`, backed by Supabase's `doc_updates`/`doc_snapshots` tables (design doc §4). Postgres
 * `bytea` round-trips through PostgREST as a `\x`-prefixed hex string, so every row is hex-encoded going in
 * and decoded coming out — see `bytesToPgHex`/`pgHexToBytes`.
 */
export class SupabaseSync implements SyncAdapter {
  constructor(private client: SupabaseClient) {}

  async pushUpdate(vaultId: string, docId: string, ciphertext: Uint8Array, deviceId: string): Promise<number> {
    const seq = await this.nextSeq(vaultId, docId)
    const { error } = await this.client
      .from('doc_updates')
      .insert({ vault_id: vaultId, doc_id: docId, seq, ciphertext: bytesToPgHex(ciphertext), device_id: deviceId })
    if (error) throw toSyncError(error)
    return seq
  }

  async pushSnapshot(vaultId: string, docId: string, ciphertext: Uint8Array, upToSeq: number): Promise<void> {
    const { error: upsertError } = await this.client
      .from('doc_snapshots')
      .upsert({ vault_id: vaultId, doc_id: docId, ciphertext: bytesToPgHex(ciphertext), up_to_seq: upToSeq })
    if (upsertError) throw toSyncError(upsertError)

    const { error: deleteError } = await this.client
      .from('doc_updates')
      .delete()
      .eq('vault_id', vaultId)
      .eq('doc_id', docId)
      .lte('seq', upToSeq)
    if (deleteError) throw toSyncError(deleteError)
  }

  async pullDoc(vaultId: string, docId: string): Promise<Uint8Array[]> {
    const { data: snap, error: snapError } = await this.client
      .from('doc_snapshots')
      .select('ciphertext')
      .eq('vault_id', vaultId)
      .eq('doc_id', docId)
      .maybeSingle()
    if (snapError) throw toSyncError(snapError)

    const { data: updates, error: updatesError } = await this.client
      .from('doc_updates')
      .select('ciphertext')
      .eq('vault_id', vaultId)
      .eq('doc_id', docId)
      .order('seq')
    if (updatesError) throw toSyncError(updatesError)

    return [
      ...(snap ? [pgHexToBytes(snap.ciphertext as string)] : []),
      ...(updates ?? []).map((u) => pgHexToBytes(u.ciphertext as string)),
    ]
  }

  async deleteDoc(vaultId: string, docId: string): Promise<void> {
    const { error: e1 } = await this.client.from('doc_updates').delete().eq('vault_id', vaultId).eq('doc_id', docId)
    if (e1) throw toSyncError(e1)
    const { error: e2 } = await this.client.from('doc_snapshots').delete().eq('vault_id', vaultId).eq('doc_id', docId)
    if (e2) throw toSyncError(e2)
  }

  async listDocs(vaultId: string): Promise<string[]> {
    const [{ data: snapRows, error: e1 }, { data: updateRows, error: e2 }] = await Promise.all([
      this.client.from('doc_snapshots').select('doc_id').eq('vault_id', vaultId),
      this.client.from('doc_updates').select('doc_id').eq('vault_id', vaultId),
    ])
    if (e1) throw toSyncError(e1)
    if (e2) throw toSyncError(e2)
    return [...new Set([...(snapRows ?? []), ...(updateRows ?? [])].map((r) => r.doc_id as string))]
  }

  /**
   * Picks the next seq by reading the current max and adding one — fine for a single device pushing
   * sequentially (3c's scope), but not safe against two push calls racing for the same doc. 3d (multiple
   * devices, real-time) needs either a DB-side sequence/trigger or an advisory lock here; flagging now so
   * it isn't missed in review.
   */
  private async nextSeq(vaultId: string, docId: string): Promise<number> {
    const [{ data: snap, error: e1 }, { data: lastUpdate, error: e2 }] = await Promise.all([
      this.client.from('doc_snapshots').select('up_to_seq').eq('vault_id', vaultId).eq('doc_id', docId).maybeSingle(),
      this.client
        .from('doc_updates')
        .select('seq')
        .eq('vault_id', vaultId)
        .eq('doc_id', docId)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (e1) throw toSyncError(e1)
    if (e2) throw toSyncError(e2)
    return Math.max(snap?.up_to_seq ?? 0, lastUpdate?.seq ?? 0) + 1
  }
}

export function bytesToPgHex(bytes: Uint8Array): string {
  let hex = '\\x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

export function pgHexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toSyncError(e: { message: string; code?: string }): SyncError {
  return new SyncError('unknown', e.message, { cause: e })
}
