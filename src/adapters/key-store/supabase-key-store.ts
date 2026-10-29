import type { SupabaseClient } from '@supabase/supabase-js'
import type { KdfParams } from '@/adapters/crypto/types'
import { KeyStoreError, type KeyStoreAdapter, type VaultKeyRecord, type VaultSummary } from './types'

type VaultKeysRow = {
  vault_id: string
  user_id: string
  wrapped_key_password: string
  kdf_params_password: KdfParams
  wrapped_key_recovery: string
  kdf_params_recovery: KdfParams
  created_at: string
}

const toRecord = (row: VaultKeysRow): VaultKeyRecord => ({
  vaultId: row.vault_id,
  userId: row.user_id,
  wrappedKeyPassword: row.wrapped_key_password,
  kdfParamsPassword: row.kdf_params_password,
  wrappedKeyRecovery: row.wrapped_key_recovery,
  kdfParamsRecovery: row.kdf_params_recovery,
  createdAt: new Date(row.created_at).getTime(),
})

/** Real `KeyStoreAdapter`, backed by Supabase's `vaults`/`vault_keys` tables (design doc §4). */
export class SupabaseKeyStore implements KeyStoreAdapter {
  constructor(private client: SupabaseClient) {}

  async createVault(record: VaultKeyRecord): Promise<void> {
    const { error: vaultError } = await this.client.from('vaults').insert({ id: record.vaultId, user_id: record.userId })
    if (vaultError) throw toKeyStoreError(vaultError)

    const { error: keysError } = await this.client.from('vault_keys').insert({
      vault_id: record.vaultId,
      user_id: record.userId,
      wrapped_key_password: record.wrappedKeyPassword,
      kdf_params_password: record.kdfParamsPassword,
      wrapped_key_recovery: record.wrappedKeyRecovery,
      kdf_params_recovery: record.kdfParamsRecovery,
    })
    if (keysError) throw toKeyStoreError(keysError)
  }

  async getVaultKeys(vaultId: string): Promise<VaultKeyRecord | undefined> {
    const { data, error } = await this.client.from('vault_keys').select('*').eq('vault_id', vaultId).maybeSingle()
    if (error) throw toKeyStoreError(error)
    return data ? toRecord(data as VaultKeysRow) : undefined
  }

  async listVaultsForUser(userId: string): Promise<VaultSummary[]> {
    const { data, error } = await this.client.from('vaults').select('id, created_at').eq('user_id', userId).order('created_at')
    if (error) throw toKeyStoreError(error)
    return (data ?? []).map((row) => ({ vaultId: row.id as string, createdAt: new Date(row.created_at as string).getTime() }))
  }

  async updateWrappedKeyPassword(vaultId: string, wrappedKeyPassword: string, kdfParamsPassword: KdfParams): Promise<void> {
    const { error, count } = await this.client
      .from('vault_keys')
      .update({ wrapped_key_password: wrappedKeyPassword, kdf_params_password: kdfParamsPassword }, { count: 'exact' })
      .eq('vault_id', vaultId)
    if (error) throw toKeyStoreError(error)
    if (!count) throw new KeyStoreError('not-found', `vault not found: ${vaultId}`)
  }
}

function toKeyStoreError(e: { message: string; code?: string }): KeyStoreError {
  if (e.code === '23505') return new KeyStoreError('already-exists', e.message, { cause: e }) // unique_violation
  return new KeyStoreError('unknown', e.message, { cause: e })
}
