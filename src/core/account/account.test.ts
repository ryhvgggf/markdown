import { beforeEach, describe, expect, it } from 'vitest'
import { AuthError } from '@/adapters/auth/types'
import { MemoryAuth } from '@/adapters/auth/memory-auth'
import { decrypt, encrypt } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryKeyStore } from '@/adapters/key-store/memory-key-store'
import { KeyStoreError } from '@/adapters/key-store/types'
import { createNewVault, recoverWithCode, requestPasswordReset, signIn, signUp, unlockVaultWithPassword } from './account'
import { AccountError } from './types'

const bytesEqual = (a: Uint8Array, b: Uint8Array) => expect(Array.from(a)).toEqual(Array.from(b))

let auth: MemoryAuth
let keyStore: MemoryKeyStore
beforeEach(() => {
  auth = new MemoryAuth()
  keyStore = new MemoryKeyStore()
})

describe('signUp', () => {
  it('creates an account, a vault, and a KEK usable to encrypt/decrypt', async () => {
    const result = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    expect(result.userId).toBeTruthy()
    expect(result.vaultId).toBeTruthy()
    expect(result.recoveryCode).toMatch(/^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/)

    const plaintext = new TextEncoder().encode('筆記內容')
    const ciphertext = await encrypt(result.kek, plaintext)
    bytesEqual(await decrypt(result.kek, ciphertext), plaintext)
  })

  it('persists a vault_keys record for the new vault', async () => {
    const { vaultId, userId } = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    const record = await keyStore.getVaultKeys(vaultId)
    expect(record?.userId).toBe(userId)
  })

  it('rejects a second sign-up with the same email', async () => {
    await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    await expect(signUp({ auth, keyStore }, 'a@example.com', 'other')).rejects.toBeInstanceOf(AuthError)
  })
})

describe('signIn + unlockVaultWithPassword', () => {
  it('lists the vault created at sign-up and unlocks it with the same password', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    const si = await signIn({ auth, keyStore }, 'a@example.com', 'hunter2')
    expect(si.userId).toBe(su.userId)
    expect(si.vaults.map((v) => v.vaultId)).toEqual([su.vaultId])

    const kek = await unlockVaultWithPassword(keyStore, su.vaultId, 'hunter2')
    const plaintext = new TextEncoder().encode('x')
    bytesEqual(await decrypt(kek, await encrypt(su.kek, plaintext)), plaintext)
  })

  it('rejects wrong login credentials', async () => {
    await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    await expect(signIn({ auth, keyStore }, 'a@example.com', 'wrong')).rejects.toBeInstanceOf(AuthError)
  })

  it('rejects unlocking with the wrong password as AccountError(wrong-password)', async () => {
    const { vaultId } = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    await expect(unlockVaultWithPassword(keyStore, vaultId, 'wrong')).rejects.toMatchObject({ kind: 'wrong-password' })
  })

  it('rejects unlocking a nonexistent vault as AccountError(not-found)', async () => {
    await expect(unlockVaultWithPassword(keyStore, 'no-such-vault', 'hunter2')).rejects.toMatchObject({ kind: 'not-found' })
  })
})

describe('forgot-password + recovery code (design doc §2, §8)', () => {
  it('requestPasswordReset delegates to the auth adapter without touching the KEK', async () => {
    await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    await requestPasswordReset(auth, 'a@example.com')
    expect(auth.resetRequested.has('a@example.com')).toBe(true)
  })

  it('the new password cannot unlock the vault after a password reset; recovery code can, and re-wraps for the new password', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')

    // Simulate Supabase's own reset-password flow completing with a new password — unrelated to the KEK.
    // (The server never saw either password, so it has nothing to re-wrap the KEK with automatically.)
    await auth.signIn('a@example.com', 'hunter2')
    await auth.setPassword('new-password')

    // wrapped_key_password is still wrapped under the OLD password, so the new one can't unwrap it.
    await expect(unlockVaultWithPassword(keyStore, su.vaultId, 'new-password')).rejects.toMatchObject({ kind: 'wrong-password' })

    // Recovery code unwraps wrapped_key_recovery and re-wraps under the new password.
    const recoveredKek = await recoverWithCode(keyStore, su.vaultId, su.recoveryCode, 'new-password')
    const plaintext = new TextEncoder().encode('still here')
    bytesEqual(await decrypt(recoveredKek, await encrypt(su.kek, plaintext)), plaintext)

    // New password now unlocks normally, no recovery code needed.
    const kek = await unlockVaultWithPassword(keyStore, su.vaultId, 'new-password')
    bytesEqual(await decrypt(kek, await encrypt(su.kek, plaintext)), plaintext)
  })

  it('accepts a recovery code typed with different casing/spacing (normalizeRecoveryCode)', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    const retyped = su.recoveryCode.toLowerCase().replace(/-/g, ' ')
    await expect(recoverWithCode(keyStore, su.vaultId, retyped, 'new-password')).resolves.toBeDefined()
  })

  it('rejects the wrong recovery code as AccountError(wrong-recovery-code)', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    await expect(recoverWithCode(keyStore, su.vaultId, 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', 'new-password')).rejects.toMatchObject({
      kind: 'wrong-recovery-code',
    })
  })

  it('rejects recovery for a nonexistent vault as AccountError(not-found)', async () => {
    await expect(recoverWithCode(keyStore, 'no-such-vault', 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', 'p')).rejects.toMatchObject({
      kind: 'not-found',
    })
  })
})

describe('createNewVault (design doc §9: lost recovery code, abandon and start over)', () => {
  it('creates a second vault under the same account with its own independent KEK', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    const nv = await createNewVault(keyStore, su.userId, 'hunter2')
    expect(nv.vaultId).not.toBe(su.vaultId)

    const { vaults } = await signIn({ auth, keyStore }, 'a@example.com', 'hunter2')
    expect(vaults.map((v) => v.vaultId).sort()).toEqual([su.vaultId, nv.vaultId].sort())

    // the two vaults' keys are independent: the old KEK does not decrypt data encrypted under the new one
    const ciphertext = await encrypt(nv.kek, new TextEncoder().encode('new vault data'))
    await expect(decrypt(su.kek, ciphertext)).rejects.toMatchObject({ kind: 'invalid-key' })
  })
})

describe('AccountError', () => {
  it('carries the original failure as cause', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    try {
      await unlockVaultWithPassword(keyStore, su.vaultId, 'wrong')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AccountError)
      expect((e as { cause?: unknown }).cause).toBeDefined()
    }
  })
})

describe('MemoryKeyStore', () => {
  it('rejects creating a vault id that already exists', async () => {
    const su = await signUp({ auth, keyStore }, 'a@example.com', 'hunter2')
    const record = await keyStore.getVaultKeys(su.vaultId)
    await expect(keyStore.createVault(record!)).rejects.toBeInstanceOf(KeyStoreError)
  })
})
