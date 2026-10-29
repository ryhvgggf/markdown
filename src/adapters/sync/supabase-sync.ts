import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { SyncError, type RemoteChange, type SyncAdapter } from './types'

/** Bounded retries for the two races flagged in 3c and closed in 3d — see `pushUpdate` and `pullDoc`. */
const MAX_SEQ_RETRIES = 5
const MAX_PULL_CONSISTENCY_RETRIES = 5

/**
 * Real `SyncAdapter`, backed by Supabase's `doc_updates`/`doc_snapshots` tables (design doc §4). Postgres
 * `bytea` round-trips through PostgREST as a `\x`-prefixed hex string, so every row is hex-encoded going in
 * and decoded coming out — see `bytesToPgHex`/`pgHexToBytes`.
 */
export class SupabaseSync implements SyncAdapter {
  constructor(private client: SupabaseClient) {}

  /**
   * Picks the next seq by reading the current max and adding one, same as 3c. Two devices can still both
   * read the same max and both try to insert the same seq — the `unique (vault_id, doc_id, seq)` constraint
   * (migration 0001) rejects the loser instead of silently overwriting, and the loser just rereads the new
   * max and retries. Bounded at `MAX_SEQ_RETRIES`: real contention this deep almost certainly means
   * something else is wrong, and an unbounded loop would hang instead of surfacing it.
   */
  async pushUpdate(vaultId: string, docId: string, ciphertext: Uint8Array, deviceId: string): Promise<number> {
    for (let attempt = 0; ; attempt++) {
      const seq = await this.nextSeq(vaultId, docId)
      const { error } = await this.client
        .from('doc_updates')
        .insert({ vault_id: vaultId, doc_id: docId, seq, ciphertext: bytesToPgHex(ciphertext), device_id: deviceId })
      if (!error) return seq
      if (isUniqueViolation(error) && attempt < MAX_SEQ_RETRIES) continue
      throw toSyncError(error)
    }
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

  /**
   * Snapshot (if any) + the updates after it, in seq order. 3c read these as two separate queries with
   * nothing tying them together; if another device's `pushSnapshot` (compaction) lands in between — new
   * snapshot written, old updates deleted — a caller could end up with the *old* snapshot plus whatever's
   * left of the updates query, silently missing the updates that got folded into the new snapshot.
   *
   * Fixed by reading the snapshot's `up_to_seq` before and after the updates query: if it's unchanged, no
   * compaction happened in between and the two reads are a consistent view; if it changed, retry from
   * scratch. Bounded at `MAX_PULL_CONSISTENCY_RETRIES` — compaction is not continuous, so a few retries
   * should always find a quiet moment; if not, something else is wrong and this should surface as an error
   * rather than loop forever.
   */
  async pullDoc(vaultId: string, docId: string): Promise<Uint8Array[]> {
    for (let attempt = 0; ; attempt++) {
      const before = await this.getSnapshot(vaultId, docId)

      const { data: updates, error: updatesError } = await this.client
        .from('doc_updates')
        .select('ciphertext')
        .eq('vault_id', vaultId)
        .eq('doc_id', docId)
        .gt('seq', before?.upToSeq ?? 0)
        .order('seq')
      if (updatesError) throw toSyncError(updatesError)

      const after = await this.getSnapshot(vaultId, docId)
      if ((before?.upToSeq ?? null) !== (after?.upToSeq ?? null)) {
        if (attempt < MAX_PULL_CONSISTENCY_RETRIES) continue
        throw new SyncError('unknown', `pullDoc(${docId}): no consistent snapshot+updates view after retries`)
      }

      return [
        ...(after ? [pgHexToBytes(after.ciphertext)] : []),
        ...(updates ?? []).map((u) => pgHexToBytes(u.ciphertext as string)),
      ]
    }
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
   * One Realtime channel per vault, fanning out to every caller that subscribed to it (cheap: this class
   * is usually constructed once per vault, but nothing stops two callers subscribing to the same one).
   * `doc_snapshots` rows carry no `device_id` (3c's schema — a snapshot is either an initial full upload or
   * a server-observed compaction, never something one device "pushes" the way an update is), so those
   * notifications report `deviceId: ''`, which never matches a real device id and so never gets filtered
   * out by a caller's self-echo check — see `MemorySync.pushSnapshot`'s matching note.
   */
  subscribe(vaultId: string, onChange: (change: RemoteChange) => void): () => void {
    let channel: RealtimeChannel | null = this.client
      .channel(`sync:${vaultId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'doc_updates', filter: `vault_id=eq.${vaultId}` },
        (payload: { new: { doc_id: string; device_id: string } }) =>
          onChange({ docId: payload.new.doc_id, deviceId: payload.new.device_id }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'doc_snapshots', filter: `vault_id=eq.${vaultId}` },
        (payload: { new: { doc_id?: string }; old: { doc_id?: string } }) => {
          const docId = payload.new.doc_id ?? payload.old.doc_id
          if (docId) onChange({ docId, deviceId: '' })
        },
      )
      .subscribe()
    return () => {
      if (channel) {
        void this.client.removeChannel(channel)
        channel = null
      }
    }
  }

  private async getSnapshot(vaultId: string, docId: string): Promise<{ ciphertext: string; upToSeq: number } | null> {
    const { data, error } = await this.client
      .from('doc_snapshots')
      .select('ciphertext, up_to_seq')
      .eq('vault_id', vaultId)
      .eq('doc_id', docId)
      .maybeSingle()
    if (error) throw toSyncError(error)
    return data ? { ciphertext: data.ciphertext as string, upToSeq: data.up_to_seq as number } : null
  }

  private async nextSeq(vaultId: string, docId: string): Promise<number> {
    const [snap, { data: lastUpdate, error: e2 }] = await Promise.all([
      this.getSnapshot(vaultId, docId),
      this.client
        .from('doc_updates')
        .select('seq')
        .eq('vault_id', vaultId)
        .eq('doc_id', docId)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (e2) throw toSyncError(e2)
    return Math.max(snap?.upToSeq ?? 0, lastUpdate?.seq ?? 0) + 1
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

/** Postgres `unique_violation`. */
function isUniqueViolation(e: { code?: string }): boolean {
  return e.code === '23505'
}

function toSyncError(e: { message: string; code?: string }): SyncError {
  return new SyncError('unknown', e.message, { cause: e })
}
