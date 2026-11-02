import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAuth } from '@/adapters/auth/memory-auth'
import { decrypt, encrypt } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryKeyStore } from '@/adapters/key-store/memory-key-store'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import { MemoryDevices } from '@/adapters/devices/memory-devices'
import { recoverWithCode } from '@/core/account/account'
import type { SyncReporter } from './sync-status'
import { createDeferredAccount, ACCOUNT_KEY, SYNC_VAULT_KEY, createAccountService, type AccountService, type MetaStore, type StoredAccount, type SyncHandle } from './account-service'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

function memoryMeta(): MetaStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async (k) => map.get(k),
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  }
}

let auth: MemoryAuth
let keyStore: MemoryKeyStore
let meta: ReturnType<typeof memoryMeta>
let vault: Vault
type StartSync = (a: { vaultId: string; kek: CryptoKey; report: SyncReporter }) => SyncHandle
let startSync: ReturnType<typeof vi.fn<StartSync>>
let stopSync: ReturnType<typeof vi.fn<() => Promise<void>>>
const services: AccountService[] = []

function make(): AccountService {
  const s = createAccountService({ auth, keyStore, meta, vault, startSync, channelFactory, redirectTo: 'https://app.test' })
  services.push(s)
  return s
}

beforeEach(async () => {
  auth = new MemoryAuth({ requireConfirmation: true })
  keyStore = new MemoryKeyStore()
  meta = memoryMeta()
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  stopSync = vi.fn(async () => {})
  startSync = vi.fn<StartSync>(() => ({ stop: stopSync }))
})
afterEach(() => {
  services.splice(0).forEach((s) => s.close())
})

async function signUpAndConfirm(s: AccountService, email = 'a@example.com', password = 'hunter2') {
  await s.signUp(email, password)
  auth.confirmEmail(email)
  await auth.signOut()
  await s.signIn(email, password)
}

describe('account service (3f-1)', () => {
  it('starts signed out with no session and no stored account', async () => {
    const s = make()
    await s.init()
    expect(s.getState()).toEqual({ status: 'signed-out' })
  })

  it('sign-up with confirmation on asks to check the email and stores nothing', async () => {
    const s = make()
    await s.init()
    await s.signUp('a@example.com', 'hunter2')
    expect(s.getState()).toEqual({ status: 'signed-out', email: 'a@example.com', notice: 'confirm-email' })
    expect(meta.map.size).toBe(0)
  })

  it('first sign-in shows the recovery code; the vault is uploaded and sync starts only after confirming', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    const st = s.getState()
    if (st.status !== 'recovery-code') throw new Error(st.status)
    expect(st.recoveryCode).toMatch(/^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/)
    const userId = (await auth.getCurrentUserId())!
    expect(await keyStore.listVaultsForUser(userId)).toEqual([])
    expect(startSync).not.toHaveBeenCalled()

    await s.confirmRecoveryCode()
    const [v] = await keyStore.listVaultsForUser(userId)
    expect(s.getState()).toEqual({ status: 'unlocked', email: 'a@example.com', vaultId: v!.vaultId })
    const stored = meta.map.get(ACCOUNT_KEY) as StoredAccount
    expect(stored.vaultId).toBe(v!.vaultId)
    expect(stored.kek.extractable).toBe(false)
    expect(startSync).toHaveBeenCalledWith(expect.objectContaining({ vaultId: v!.vaultId, kek: stored.kek }))
  })

  it('a restart with the stored account and a live session is unlocked at once and syncs', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    s.close()

    const again = make()
    await again.init()
    expect(again.getState().status).toBe('unlocked')
    expect(startSync).toHaveBeenCalledTimes(2)
  })

  it('a restart whose session ended forgets the stored key and asks to sign in again', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    s.close()
    await auth.signOut()

    const again = make()
    await again.init()
    expect(again.getState()).toEqual({ status: 'signed-out', email: 'a@example.com' })
    expect(meta.map.has(ACCOUNT_KEY)).toBe(false)
  })

  it('a session without a key on this device (the confirmation link) is locked until the password is typed', async () => {
    const s = make()
    await s.init()
    await s.signUp('a@example.com', 'hunter2')
    auth.confirmEmail('a@example.com') // the link signs this page in
    await s.init()
    expect(s.getState()).toEqual({ status: 'locked', email: 'a@example.com' })
    await expect(s.unlock('wrong')).rejects.toMatchObject({ kind: 'invalid-credentials' })
    await s.unlock('hunter2')
    expect(s.getState().status).toBe('recovery-code')
  })

  it('signing in again on another device unlocks the same vault with the same key', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    const first = meta.map.get(ACCOUNT_KEY) as StoredAccount
    await s.signOut()

    const other = memoryMeta()
    meta = other
    const d2 = make()
    await d2.init()
    await d2.signIn('a@example.com', 'hunter2')
    const second = other.map.get(ACCOUNT_KEY) as StoredAccount
    expect(second.vaultId).toBe(first.vaultId)
    const ct = await encrypt(first.kek, new TextEncoder().encode('x'))
    expect(new TextDecoder().decode(await decrypt(second.kek, ct))).toBe('x')
  })

  it('sign-out stops sync, ends the session and forgets the key', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    await s.signOut()
    expect(stopSync).toHaveBeenCalled()
    expect(await auth.getCurrentUserId()).toBeNull()
    expect(meta.map.has(ACCOUNT_KEY)).toBe(false)
    expect(s.getState()).toEqual({ status: 'signed-out', email: 'a@example.com' })
  })

  it('reset link → new password → recovery code re-wraps the key for the new password', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    const code = (s.getState() as { recoveryCode: string }).recoveryCode
    await s.confirmRecoveryCode()
    await s.signOut()

    await s.requestPasswordReset('a@example.com')
    expect(s.getState()).toMatchObject({ status: 'signed-out', notice: 'reset-sent' })
    auth.openResetLink('a@example.com')
    await vi.waitFor(() => expect(s.getState()).toEqual({ status: 'set-password', email: 'a@example.com' }))
    await s.setNewPassword('new-password')
    expect(s.getState()).toEqual({ status: 'needs-recovery', email: 'a@example.com' })
    await expect(s.recover('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX')).rejects.toMatchObject({ kind: 'wrong-recovery-code' })
    await s.recover(code.toLowerCase())
    expect(s.getState().status).toBe('unlocked')

    await s.signOut()
    await s.signIn('a@example.com', 'new-password')
    expect(s.getState().status).toBe('unlocked')
  })

  it('a lost recovery code can start a new vault; local synced flags are cleared for it', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    const oldVault = (s.getState() as { vaultId: string }).vaultId
    const note = vault.createNote({ title: 'A' })
    vault.setNoteSynced(note.id, true)
    await s.signOut()
    await auth.signIn('a@example.com', 'hunter2')
    await auth.setPassword('new-password')
    await auth.signOut()

    await s.signIn('a@example.com', 'new-password')
    expect(s.getState().status).toBe('needs-recovery')
    await s.abandonVault()
    expect(s.getState().status).toBe('recovery-code')
    await s.confirmRecoveryCode()
    const st = s.getState() as { status: string; vaultId: string }
    expect(st.status).toBe('unlocked')
    expect(st.vaultId).not.toBe(oldVault)
    expect(vault.getNote(note.id)?.synced).toBe(false)
    expect(meta.map.get(SYNC_VAULT_KEY)).toBe(st.vaultId)

    // two vaults now: the next sign-in asks which one
    await s.signOut()
    await s.signIn('a@example.com', 'new-password')
    const choose = s.getState()
    if (choose.status !== 'choose-vault') throw new Error(choose.status)
    expect(choose.vaults).toHaveLength(2)
    await s.chooseVault(st.vaultId)
    expect(s.getState()).toMatchObject({ status: 'unlocked', vaultId: st.vaultId })
  })

  it('unlocking the same vault again keeps the notes it already syncs', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    const note = vault.createNote({ title: 'A' })
    vault.setNoteSynced(note.id, true)
    await s.signOut()
    await s.signIn('a@example.com', 'hunter2')
    expect(vault.getNote(note.id)?.synced).toBe(true)
  })

  it('cancel in the middle of a flow signs out and drops the pending vault', async () => {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    await s.cancel()
    expect(s.getState()).toEqual({ status: 'signed-out', email: 'a@example.com' })
    await expect(s.confirmRecoveryCode()).rejects.toBeDefined()
    expect(await keyStore.listVaultsForUser((await auth.signIn('a@example.com', 'hunter2')).userId)).toEqual([])
  })
})

describe('account service (3f-2)', () => {
  async function unlocked() {
    const s = make()
    await s.init()
    await signUpAndConfirm(s)
    const st = s.getState()
    if (st.status !== 'recovery-code') throw new Error(st.status)
    await s.confirmRecoveryCode()
    const vaultId = (s.getState() as { vaultId: string }).vaultId
    return { s, oldCode: st.recoveryCode, vaultId }
  }

  it('the sync run reports into the sync status; sign-out turns it off', async () => {
    const { s } = await unlocked()
    const report = startSync.mock.calls[0]![0].report
    report.pending(false)
    expect(s.getSyncStatus().state).toBe('synced')
    report.error(Object.assign(new Error('x'), { kind: 'conflict' }), 'n1')
    expect(s.getSyncStatus().issues).toEqual([{ docId: 'n1', kind: 'conflict' }])
    s.dismissSyncIssues()
    expect(s.getSyncStatus().issues).toEqual([])
    await s.signOut()
    expect(s.getSyncStatus().state).toBe('off')
  })

  it('regenerating the recovery code: wrong password changes nothing; confirm replaces the code', async () => {
    const { s, oldCode, vaultId } = await unlocked()
    await expect(s.prepareRecoveryCode('wrong')).rejects.toMatchObject({ kind: 'wrong-password' })
    const code = await s.prepareRecoveryCode('hunter2')
    await expect(recoverWithCode(keyStore, vaultId, oldCode, 'hunter2')).resolves.toBeDefined()
    await s.confirmNewRecoveryCode()
    await expect(recoverWithCode(keyStore, vaultId, oldCode, 'hunter2')).rejects.toMatchObject({ kind: 'wrong-recovery-code' })
    await expect(recoverWithCode(keyStore, vaultId, code, 'hunter2')).resolves.toBeDefined()
    await expect(s.confirmNewRecoveryCode()).rejects.toBeDefined() // nothing pending any more
  })

  it('cancelling a regenerated code keeps the old one', async () => {
    const { s, oldCode, vaultId } = await unlocked()
    await s.prepareRecoveryCode('hunter2')
    s.cancelNewRecoveryCode()
    await expect(s.confirmNewRecoveryCode()).rejects.toBeDefined()
    await expect(recoverWithCode(keyStore, vaultId, oldCode, 'hunter2')).resolves.toBeDefined()
  })
})

describe('account service — devices (3f-3)', () => {
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  }
  function makeWith(devices: MemoryDevices, deviceId: string, deviceCheckMs?: number) {
    const s = createAccountService({ auth, keyStore, meta, vault, startSync, channelFactory, devices, deviceId: () => deviceId, deviceCheckMs })
    services.push(s)
    return s
  }

  it('unlocking registers this device; the list marks it; other devices can be renamed and removed', async () => {
    const devices = new MemoryDevices()
    const s = makeWith(devices, 'this')
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    await until(() => devices.rows.has('this'))
    await devices.register('other', 'u', 'Old name')
    const { devices: list, thisDevice } = await s.listDevices()
    expect(thisDevice).toBe('this')
    expect(list.map((d) => d.id).sort()).toEqual(['other', 'this'])
    await s.renameDevice('other', '  我的 iPad ')
    expect(devices.rows.get('other')?.name).toBe('我的 iPad')
    await expect(s.removeDevice('this')).rejects.toThrow()
    await s.removeDevice('other')
    expect(devices.rows.has('other')).toBe(false)
  })

  it('a device removed from another one is signed out at its next check', async () => {
    const devices = new MemoryDevices()
    const s = makeWith(devices, 'this', 20)
    await s.init()
    await signUpAndConfirm(s)
    await s.confirmRecoveryCode()
    await until(() => devices.rows.has('this'))
    await new Promise((r) => setTimeout(r, 10)) // let the first check-in finish recording the registration
    await devices.remove('this')
    await until(() => s.getState().status === 'signed-out')
    expect(s.getState()).toEqual({ status: 'signed-out', email: 'a@example.com', notice: 'device-removed' })
    expect(meta.map.has(ACCOUNT_KEY)).toBe(false)
    expect(stopSync).toHaveBeenCalled()
  })
})

describe('deferred account', () => {
  it('returns the same state and sync status objects while still loading (useSyncExternalStore needs stable snapshots)', () => {
    const d = createDeferredAccount(() => new Promise(() => {}))
    expect(d.getState()).toBe(d.getState())
    expect(d.getSyncStatus()).toBe(d.getSyncStatus())
    d.close()
  })
})
