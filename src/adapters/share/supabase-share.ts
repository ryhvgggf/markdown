import type { SupabaseClient } from '@supabase/supabase-js'
import { bytesToPgHex, pgHexToBytes } from '@/adapters/sync/supabase-sync'
import { SHARE_FILE_TOKEN_SECONDS, ShareError } from './types'
import type { GuardedWrite, NewShare, NewSharePassword, ProtectedOpen, PublicShare, ShareAdapter, ShareRecord } from './types'

type Row = {
  id: string
  vault_id: string
  note_id: string
  note_ids: string[] | null
  wrapped_key: string
  created_at: string
  updated_at: string
  expires_at: string | null
  pw_salt: string | null
  pw_iterations: number | null
  pw_key: string | null
}
const COLUMNS = 'id, vault_id, note_id, note_ids, wrapped_key, created_at, updated_at, expires_at, pw_salt, pw_iterations, pw_key'

/** Postgres 42501 (row-level security) and PostgREST's JWT errors: the request had no valid sign-in. */
const NOT_SIGNED_IN = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303'])
const toError = (e: { message: string; code?: string }) => new ShareError(e.code && NOT_SIGNED_IN.has(e.code) ? 'signed-out' : 'unknown', e.message, { cause: e })

const toRecord = (r: Row): ShareRecord => ({
  id: r.id,
  vaultId: r.vault_id,
  noteId: r.note_id,
  noteIds: r.note_ids ?? null,
  wrappedKey: r.wrapped_key,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
  expiresAt: r.expires_at === null ? null : Date.parse(r.expires_at),
  password: r.pw_salt !== null && r.pw_iterations !== null && r.pw_key !== null ? { saltB64: r.pw_salt, iterations: r.pw_iterations, pwKey: r.pw_key } : null,
})

/**
 * `ShareAdapter` on Supabase's `share_links` table (migrations 0004–0007). The owner reads and writes through
 * RLS (own rows only); expiry and renewal go through functions so the database clock and one transaction decide.
 * Viewers are anonymous and never select from the table — they call `get_shared_snapshot` and, for a protected
 * link, `open_protected_snapshot`, which return one row's data by id, so links cannot be listed.
 */
export class SupabaseShare implements ShareAdapter {
  /** `<project>/storage/v1`, for viewer downloads by token. */
  private storageUrl: string
  constructor(
    private client: SupabaseClient,
    projectUrl = '',
  ) {
    this.storageUrl = `${projectUrl.replace(/\/+$/, '')}/storage/v1`
  }

  async create(s: NewShare): Promise<void> {
    const { error } = await this.client.from('share_links').insert({
      id: s.id,
      vault_id: s.vaultId,
      note_id: s.noteId,
      ...(s.noteIds && { note_ids: s.noteIds }),
      user_id: s.userId,
      wrapped_key: s.wrappedKey,
      ciphertext: bytesToPgHex(s.ciphertext),
    })
    if (error) throw toError(error)
  }

  /** A guarded owner write done by a database function (migration 0006) that answers ok／changed／not-found. */
  private async guarded(fn: string, args: Record<string, unknown>): Promise<GuardedWrite> {
    const { data, error } = await this.client.rpc(fn, args)
    if (error) throw toError(error)
    if (data === 'ok' || data === 'not-found' || data === 'changed') return data
    throw new ShareError('unknown', `unexpected ${fn} result`)
  }

  update(id: string, ciphertext: Uint8Array, expectedSalt: string | null, expectedHash?: Uint8Array): Promise<GuardedWrite> {
    return this.guarded('update_share_snapshot', {
      p_id: id,
      p_ciphertext: bytesToPgHex(ciphertext),
      p_expected_salt: expectedSalt,
      ...(expectedHash && { p_expected_hash: bytesToPgHex(expectedHash) }),
    })
  }

  setPassword(
    id: string,
    ciphertext: Uint8Array,
    password: NewSharePassword | null,
    expectedSalt: string | null,
    expectedHash: Uint8Array,
  ): Promise<GuardedWrite> {
    return this.guarded('set_share_password', {
      p_id: id,
      p_ciphertext: bytesToPgHex(ciphertext),
      p_salt: password?.saltB64 ?? null,
      p_iterations: password?.iterations ?? null,
      p_verifier: password ? bytesToPgHex(password.verifier) : null,
      p_key: password?.pwKey ?? null,
      p_expected_salt: expectedSalt,
      p_expected_hash: bytesToPgHex(expectedHash),
    })
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('share_links').delete().eq('id', id)
    if (error) throw toError(error)
  }

  setNotes(id: string, noteIds: string[], ciphertext: Uint8Array, expectedSalt: string | null, expectedHash: Uint8Array): Promise<GuardedWrite> {
    return this.guarded('set_share_notes', {
      p_id: id,
      p_note_ids: noteIds,
      p_ciphertext: bytesToPgHex(ciphertext),
      p_expected_salt: expectedSalt,
      p_expected_hash: bytesToPgHex(expectedHash),
    })
  }

  /** Through `remove_shares_for_notes` (migration 0007), which also matches multi-note links on any of their notes. */
  async removeForNotes(vaultId: string, noteIds: string[]): Promise<void> {
    if (!noteIds.length) return
    const { error } = await this.client.rpc('remove_shares_for_notes', { p_vault: vaultId, p_note_ids: noteIds })
    if (error) throw toError(error)
  }

  async listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]> {
    const { data, error } = await this.client
      .from('share_links')
      .select(COLUMNS)
      .eq('vault_id', vaultId)
      .eq('note_id', noteId)
      .is('note_ids', null)
      .order('created_at', { ascending: false })
    if (error) throw toError(error)
    return ((data ?? []) as Row[]).map(toRecord)
  }

  async listForVault(vaultId: string): Promise<ShareRecord[]> {
    const { data, error } = await this.client.from('share_links').select(COLUMNS).eq('vault_id', vaultId).order('created_at', { ascending: false })
    if (error) throw toError(error)
    return ((data ?? []) as Row[]).map(toRecord)
  }

  async getOwn(id: string): Promise<{ record: ShareRecord; ciphertext: Uint8Array } | null> {
    const { data, error } = await this.client.from('share_links').select(`${COLUMNS}, ciphertext`).eq('id', id)
    if (error) throw toError(error)
    const row = ((data ?? []) as Array<Row & { ciphertext: string }>)[0]
    return row ? { record: toRecord(row), ciphertext: pgHexToBytes(row.ciphertext) } : null
  }

  async setExpiry(id: string, seconds: number | null): Promise<{ expiresAt: number | null } | 'not-found'> {
    const { data, error } = await this.client.rpc('set_share_expiry', { p_id: id, p_seconds: seconds })
    if (error) throw toError(error)
    const row = ((data ?? []) as Array<{ expires_at: string | null }>)[0]
    if (!row) return 'not-found'
    return { expiresAt: row.expires_at === null ? null : Date.parse(row.expires_at) }
  }

  async renew(
    oldId: string,
    next: { id: string; wrappedKey: string; ciphertext: Uint8Array; verifier: Uint8Array | null; pwKey: string | null },
    expectedSalt: string | null,
    expectedHash: Uint8Array,
  ): Promise<GuardedWrite> {
    return this.guarded('renew_share_link', {
      p_old: oldId,
      p_new: next.id,
      p_wrapped_key: next.wrappedKey,
      p_ciphertext: bytesToPgHex(next.ciphertext),
      p_pw_verifier: next.verifier ? bytesToPgHex(next.verifier) : null,
      p_pw_key: next.pwKey,
      p_expected_salt: expectedSalt,
      p_expected_hash: bytesToPgHex(expectedHash),
    })
  }

  async getPublic(id: string): Promise<PublicShare | null> {
    const { data, error } = await this.client.rpc('get_shared_snapshot', { p_id: id })
    if (error) throw toError(error)
    const row = ((data ?? []) as Array<{ status: string; ciphertext: string | null; pw_salt: string | null; pw_iterations: number | null }>)[0]
    if (!row) return null
    if (row.status === 'expired') return { status: 'expired' }
    if (row.status === 'password' && row.pw_salt !== null && row.pw_iterations !== null)
      return { status: 'password', saltB64: row.pw_salt, iterations: row.pw_iterations }
    if (row.status === 'ok' && row.ciphertext !== null) return { status: 'ok', ciphertext: pgHexToBytes(row.ciphertext) }
    throw new ShareError('unknown', 'unexpected snapshot status')
  }

  async openProtected(id: string, proof: Uint8Array): Promise<ProtectedOpen | null> {
    const { data, error } = await this.client.rpc('open_protected_snapshot', { p_id: id, p_proof: bytesToPgHex(proof) })
    if (error) throw toError(error)
    const row = ((data ?? []) as Array<{ status: string; ciphertext: string | null; pw_salt: string | null }>)[0]
    if (!row) return null
    if (row.status === 'expired' || row.status === 'wrong') return { status: row.status }
    if (row.status === 'ok' && row.ciphertext !== null) return { status: 'ok', ciphertext: pgHexToBytes(row.ciphertext), passwordSalt: row.pw_salt }
    throw new ShareError('unknown', 'unexpected snapshot status')
  }

  // ---- files (migration 0008): bucket `share-files`, objects at `<shareId>/<objectName>` ----
  private get bucket() {
    return this.client.storage.from(SHARE_BUCKET)
  }

  async claimFolder(shareId: string): Promise<void> {
    const { data, error } = await this.client.rpc('claim_share_folder', { p_id: shareId })
    if (error) throw toError(error)
    if (data !== 'ok') throw new ShareError('unknown', 'share folder belongs to someone else')
  }

  async uploadFile(shareId: string, objectName: string, ciphertext: Uint8Array): Promise<void> {
    const body = new Blob([ciphertext as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
    const { error } = await this.bucket.upload(`${shareId}/${objectName}`, body, { contentType: 'application/octet-stream', upsert: false })
    if (error) throw storageError(error)
  }

  async copyFiles(fromShareId: string, toShareId: string, objectNames: string[]): Promise<void> {
    for (const o of objectNames) {
      const { error } = await this.bucket.copy(`${fromShareId}/${o}`, `${toShareId}/${o}`)
      if (error) throw storageError(error)
    }
  }

  async deleteFiles(shareId: string, objectNames: string[]): Promise<void> {
    for (let i = 0; i < objectNames.length; i += STORAGE_BATCH) {
      const { error } = await this.bucket.remove(objectNames.slice(i, i + STORAGE_BATCH).map((o) => `${shareId}/${o}`))
      if (error) throw storageError(error)
    }
  }

  async releaseFolder(shareId: string): Promise<void> {
    for (;;) {
      const names = (await this.listFiles(shareId)).map((o) => o.name)
      if (!names.length) break
      const { data, error } = await this.bucket.remove(names.map((o) => `${shareId}/${o}`))
      if (error) throw storageError(error)
      if (!data?.length) throw new ShareError('unknown', 'cannot delete share files') // not this account's folder
    }
    const { error } = await this.client.from('share_folders').delete().eq('share_id', shareId)
    if (error) throw toError(error)
  }

  async orphanFolders(): Promise<string[]> {
    const { data, error } = await this.client.rpc('orphan_share_folders')
    if (error) throw toError(error)
    return ((data ?? []) as unknown[]).filter((x): x is string => typeof x === 'string')
  }

  async listFiles(shareId: string): Promise<Array<{ name: string; createdAt: number }>> {
    const out: Array<{ name: string; createdAt: number }> = []
    for (let offset = 0; ; offset += STORAGE_BATCH) {
      const { data, error } = await this.bucket.list(shareId, { limit: STORAGE_BATCH, offset })
      if (error) throw storageError(error)
      const page = (data ?? []).filter((o) => !!o.name && o.id !== null)
      for (const o of page) out.push({ name: o.name, createdAt: o.created_at ? Date.parse(o.created_at) : 0 })
      if ((data ?? []).length < STORAGE_BATCH) return out
    }
  }

  async signFiles(shareId: string, objectNames: string[]): Promise<string[]> {
    const out: string[] = []
    for (let i = 0; i < objectNames.length; i += STORAGE_BATCH) {
      const paths = objectNames.slice(i, i + STORAGE_BATCH).map((o) => `${shareId}/${o}`)
      const { data, error } = await this.bucket.createSignedUrls(paths, SHARE_FILE_TOKEN_SECONDS)
      if (error) throw storageError(error)
      for (const p of paths) {
        const row = (data ?? []).find((d) => d.path === p)
        const token = row?.signedUrl ? new URL(row.signedUrl, 'https://x.invalid').searchParams.get('token') : null
        if (!token) throw new ShareError('unknown', 'no download token')
        out.push(token)
      }
    }
    return out
  }

  /**
   * Through the signed-URL endpoint (viewers have no read policy on the bucket). The base URL is this client's
   * project, never anything from the snapshot.
   */
  async downloadFile(shareId: string, objectName: string, token: string): Promise<Uint8Array | null> {
    const url = `${this.storageUrl}/object/sign/${SHARE_BUCKET}/${shareId}/${objectName}?token=${encodeURIComponent(token)}`
    let res: Response
    try {
      res = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' })
    } catch (e) {
      throw new ShareError('unavailable', 'network', { cause: e })
    }
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return null
    if (!res.ok) throw new ShareError('unknown', `download failed (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export const SHARE_BUCKET = 'share-files'
const STORAGE_BATCH = 100
const storageError = (e: { message: string }) => new ShareError('unknown', e.message, { cause: e })
