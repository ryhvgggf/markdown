import type { AuthAdapter } from '@/adapters/auth/types'
import { deriveKeyFromSecret, fromB64, generateKek, toB64, unwrapKey, wrapKey } from '@/adapters/crypto/webcrypto-crypto'
import type { KeyStoreAdapter, VaultKeyRecord, VaultSummary } from '@/adapters/key-store/types'
import { generateRecoveryCode, normalizeRecoveryCode } from '@/adapters/crypto/recovery-code'
import { toCryptoError } from '@/adapters/crypto/types'
import { newId } from '../ids'
import { AccountError } from './types'
import type { NewVaultResult, SignInResult, SignUpResult } from './types'

/**
 * `core/account` — sign-up, sign-in, and the recovery-code flow from the phase 3 design doc §2 and §8.
 * Takes its `AuthAdapter` and `KeyStoreAdapter` as parameters rather than importing a concrete adapter, so
 * it stays swappable and testable with the in-memory fakes (same principle as `core/vault` + `StorageAdapter`).
 */

export interface AccountDeps {
  auth: AuthAdapter
  keyStore: KeyStoreAdapter
}

/**
 * A knowledge base whose KEK and recovery code exist only in memory so far. Nothing reaches the server until
 * `commitVault` — the UI shows the recovery code first and commits only after the user confirms they wrote it
 * down, so closing the tab mid-way never leaves a cloud vault whose recovery code nobody ever saw.
 */
export interface PendingVault extends NewVaultResult {
  record: VaultKeyRecord
}

/** Generates a fresh KEK and wraps it under both the password and a freshly generated recovery code. Local only. */
export async function prepareVault(userId: string, password: string): Promise<PendingVault> {
  const kek = await generateKek()
  const recoveryCode = generateRecoveryCode()
  const { key: pwKey, params: kdfParamsPassword } = await deriveKeyFromSecret(password)
  const { key: recoveryKey, params: kdfParamsRecovery } = await deriveKeyFromSecret(normalizeRecoveryCode(recoveryCode))
  const wrappedKeyPassword = toB64(await wrapKey(kek, pwKey))
  const wrappedKeyRecovery = toB64(await wrapKey(kek, recoveryKey))
  const vaultId = newId()
  const record: VaultKeyRecord = {
    vaultId,
    userId,
    wrappedKeyPassword,
    kdfParamsPassword,
    wrappedKeyRecovery,
    kdfParamsRecovery,
    createdAt: Date.now(),
  }
  return { vaultId, kek, recoveryCode, record }
}

/** Uploads a prepared vault's wrapped keys (design doc §2). */
export async function commitVault(keyStore: KeyStoreAdapter, pending: PendingVault): Promise<void> {
  await keyStore.createVault(pending.record)
}

async function provisionVault(keyStore: KeyStoreAdapter, userId: string, password: string): Promise<NewVaultResult> {
  const pending = await prepareVault(userId, password)
  await commitVault(keyStore, pending)
  const { vaultId, kek, recoveryCode } = pending
  return { vaultId, kek, recoveryCode }
}

/**
 * Creates the login only (Supabase Auth). With "Confirm email" on there is no session until the user follows
 * the link, so the vault cannot be written yet (RLS) — it is prepared on the first `signInAndResolve` instead.
 */
export async function registerAccount(
  auth: AuthAdapter,
  email: string,
  password: string,
  opts?: { redirectTo?: string },
): Promise<{ userId: string; needsConfirmation: boolean }> {
  return auth.signUp(email, password, opts)
}

/**
 * What the caller must do next after proving identity with a password (design doc §2, §8, §9):
 * - `unlocked`: the password unwrapped the vault's KEK.
 * - `new-vault`: the account has no vault yet (first sign-in after confirming the email) — show the recovery
 *   code, then `commitVault`.
 * - `choose-vault`: several vaults (one was abandoned after a lost recovery code) — call again with `vaultId`.
 * - `needs-recovery`: the password is right for the login but does not unwrap the KEK — it was reset through
 *   email, so the recovery code is needed (`recoverWithCode`), or the vault is abandoned (`prepareVault`).
 */
export type ResolveResult =
  | { kind: 'unlocked'; vaultId: string; kek: CryptoKey }
  | { kind: 'new-vault'; pending: PendingVault }
  | { kind: 'choose-vault'; vaults: VaultSummary[] }
  | { kind: 'needs-recovery'; vaultId: string }

export async function resolveVault(
  keyStore: KeyStoreAdapter,
  userId: string,
  password: string,
  vaultId?: string,
): Promise<ResolveResult> {
  const vaults = await keyStore.listVaultsForUser(userId)
  if (vaults.length === 0) return { kind: 'new-vault', pending: await prepareVault(userId, password) }
  const chosen = vaultId ?? (vaults.length === 1 ? vaults[0]!.vaultId : undefined)
  if (!chosen) return { kind: 'choose-vault', vaults }
  if (!vaults.some((v) => v.vaultId === chosen)) throw new AccountError('not-found', `vault not found: ${chosen}`)
  try {
    return { kind: 'unlocked', vaultId: chosen, kek: await unlockVaultWithPassword(keyStore, chosen, password) }
  } catch (e) {
    if (e instanceof AccountError && e.kind === 'wrong-password') return { kind: 'needs-recovery', vaultId: chosen }
    throw e
  }
}

/** Signs in, then `resolveVault`. */
export async function signInAndResolve(
  deps: AccountDeps,
  email: string,
  password: string,
  vaultId?: string,
): Promise<{ userId: string } & ResolveResult> {
  const { userId } = await deps.auth.signIn(email, password)
  return { userId, ...(await resolveVault(deps.keyStore, userId, password, vaultId)) }
}

/**
 * The copy of a KEK this device keeps between sessions: same key bytes, but non-extractable, so script running
 * in the page can use it but never read it out. Re-wrapping (password change, recovery) always unwraps a fresh
 * extractable copy from the server instead.
 */
export async function toDeviceKek(kek: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.exportKey('raw', kek)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** 設計文件 8 節「啟用同步」：建帳號 + 第一個知識庫的 KEK。 */
export async function signUp(deps: AccountDeps, email: string, password: string): Promise<SignUpResult> {
  const { userId } = await deps.auth.signUp(email, password)
  const vault = await provisionVault(deps.keyStore, userId, password)
  return { userId, ...vault }
}

/** 登入，回傳帳號底下的知識庫清單（通常只有一個；有多個時由呼叫端決定要開哪個，見設計文件 §2、§8）。 */
export async function signIn(deps: AccountDeps, email: string, password: string): Promise<SignInResult> {
  const { userId } = await deps.auth.signIn(email, password)
  const vaults = await deps.keyStore.listVaultsForUser(userId)
  return { userId, vaults }
}

/** 用密碼解開某個知識庫的 KEK（登入後，選定知識庫時呼叫）。 */
export async function unlockVaultWithPassword(keyStore: KeyStoreAdapter, vaultId: string, password: string): Promise<CryptoKey> {
  const record = await keyStore.getVaultKeys(vaultId)
  if (!record) throw new AccountError('not-found', `vault not found: ${vaultId}`)
  const { key: pwKey } = await deriveKeyFromSecret(password, record.kdfParamsPassword)
  try {
    return await unwrapKey(fromB64(record.wrappedKeyPassword), pwKey)
  } catch (e) {
    throw new AccountError('wrong-password', 'wrong password', { cause: toCryptoError(e) })
  }
}

/** 設計文件 §8「忘記密碼」：觸發 Supabase 標準 email 重設流程。本身不處理 KEK。 */
export async function requestPasswordReset(auth: AuthAdapter, email: string, opts?: { redirectTo?: string }): Promise<void> {
  await auth.requestPasswordReset(email, opts)
}

/**
 * 設計文件 §8「忘記密碼」最後一步：使用者重設密碼後解不開 `wrapped_key_password`，改用復原碼解開 KEK，
 * 再用新密碼重新包一份覆蓋回去。呼叫前假設 `auth.setPassword(newPassword)` 已經完成（Supabase 重設密碼流程）。
 */
export async function recoverWithCode(
  keyStore: KeyStoreAdapter,
  vaultId: string,
  recoveryCode: string,
  newPassword: string,
): Promise<CryptoKey> {
  const record = await keyStore.getVaultKeys(vaultId)
  if (!record) throw new AccountError('not-found', `vault not found: ${vaultId}`)
  const { key: recoveryKey } = await deriveKeyFromSecret(normalizeRecoveryCode(recoveryCode), record.kdfParamsRecovery)
  let kek: CryptoKey
  try {
    kek = await unwrapKey(fromB64(record.wrappedKeyRecovery), recoveryKey)
  } catch (e) {
    throw new AccountError('wrong-recovery-code', 'wrong recovery code', { cause: toCryptoError(e) })
  }
  const { key: newPwKey, params: kdfParamsPassword } = await deriveKeyFromSecret(newPassword)
  const wrappedKeyPassword = toB64(await wrapKey(kek, newPwKey))
  await keyStore.updateWrappedKeyPassword(vaultId, wrappedKeyPassword, kdfParamsPassword)
  return kek
}

/** 設計文件 §9「復原碼遺失且忘記密碼」：放棄舊知識庫，同一帳號下開一把新 KEK 的新知識庫。 */
export async function createNewVault(keyStore: KeyStoreAdapter, userId: string, password: string): Promise<NewVaultResult> {
  return provisionVault(keyStore, userId, password)
}
