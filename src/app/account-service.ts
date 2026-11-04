import { AuthError, type AuthAdapter } from '@/adapters/auth/types'
import type { KeyStoreAdapter, VaultSummary } from '@/adapters/key-store/types'
import {
  commitRecoveryCode,
  commitVault,
  prepareRecoveryCode,
  prepareVault,
  recoverWithCode,
  registerAccount,
  requestPasswordReset,
  resolveVault,
  signInAndResolve,
  toDeviceKek,
  type PendingRecoveryCode,
  type PendingVault,
  type ResolveResult,
} from '@/core/account/account'
import { AccountError } from '@/core/account/types'
import { checkInDevice, defaultDeviceName } from '@/core/account/devices'
import type { DeviceAdapter, DeviceRecord } from '@/adapters/devices/types'
import type { Vault } from '@/core/vault/vault'
import { createSyncStatus, type SyncReporter, type SyncStatus } from './sync-status'

/**
 * The account state the UI renders (phase 3f-1). One object per tab; tabs tell each other about changes
 * over a BroadcastChannel and re-read the stored account.
 * - `unavailable`: no Supabase project configured — the app is local-only.
 * - `locked`: signed in (e.g. just followed the confirmation link) but this device holds no key yet.
 * - `set-password`: opened from a reset-password link.
 * - `recovery-code`: a new vault's code is on screen; nothing is uploaded until `confirmRecoveryCode`.
 * - `needs-recovery`: the password is right for the login but not for the vault (it was reset by email).
 */
export type AccountState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed-out'; email?: string; notice?: 'confirm-email' | 'reset-sent' | 'device-removed' }
  | { status: 'locked'; email: string }
  | { status: 'set-password'; email: string }
  | { status: 'recovery-code'; email: string; recoveryCode: string }
  | { status: 'choose-vault'; email: string; vaults: VaultSummary[] }
  | { status: 'needs-recovery'; email: string }
  | { status: 'unlocked'; email: string; vaultId: string }

/** What this device keeps between sessions (`db.meta`). `kek` is the non-extractable device copy. */
export interface StoredAccount {
  userId: string
  email: string
  vaultId: string
  kek: CryptoKey
}

export interface MetaStore {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface SyncHandle {
  stop(): Promise<void>
}

export interface AccountServiceDeps {
  auth: AuthAdapter
  keyStore: KeyStoreAdapter
  meta: MetaStore
  vault: Vault
  /** Starts cloud sync for the unlocked vault (the app runs it in one tab only). */
  startSync?: (a: { vaultId: string; kek: CryptoKey; report: SyncReporter }) => SyncHandle
  /** Where confirmation and reset-password links land. */
  redirectTo?: string
  channelFactory?: (name: string) => BroadcastChannel
  /** The account's device list (3f-3); without it there is no device bookkeeping. */
  devices?: DeviceAdapter
  /** This browser's id (`core/sync-engine/device-id.ts`). */
  deviceId?: () => string
  /** How often a running device re-checks that it hasn't been removed. */
  deviceCheckMs?: number
}

export interface AccountService {
  getState(): AccountState
  subscribe(cb: () => void): () => void
  init(): Promise<void>
  signUp(email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  /** `locked`: unlock this device's copy with the account password. */
  unlock(password: string): Promise<void>
  chooseVault(vaultId: string): Promise<void>
  confirmRecoveryCode(): Promise<void>
  /** `needs-recovery`: open the vault with its recovery code and re-wrap it for the current password. */
  recover(recoveryCode: string): Promise<void>
  /** `needs-recovery` with the code lost: start a new vault under the same account (old cloud data stays unreadable). */
  abandonVault(): Promise<void>
  /** `set-password`: the new login password; the vault is resolved with it right after. */
  setNewPassword(password: string): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  signOut(): Promise<void>
  /** `unlocked`: a new recovery code, checked against the password and shown before anything is uploaded. */
  prepareRecoveryCode(password: string): Promise<string>
  /** Uploads the code from `prepareRecoveryCode`; the old code stops working. */
  confirmNewRecoveryCode(): Promise<void>
  cancelNewRecoveryCode(): void
  getSyncStatus(): SyncStatus
  subscribeSync(cb: () => void): () => void
  dismissSyncIssues(): void
  /** `unlocked`: the account's devices; `thisDevice` marks this browser. */
  listDevices(): Promise<{ devices: DeviceRecord[]; thisDevice: string }>
  renameDevice(id: string, name: string): Promise<void>
  /** Removes another device: it is signed out the next time it connects. */
  removeDevice(id: string): Promise<void>
  /** Back from a mid-flow screen to the sign-in form (forgets the password held for the flow). */
  cancel(): Promise<void>
  close(): void
}

export const ACCOUNT_KEY = 'account'
/** The cloud vault this device's `synced` flags belong to (see `finishUnlock`). */
export const SYNC_VAULT_KEY = 'syncVaultId'
/** The cloud vault this device attached to for the first time and has not yet finished its first sync of (see `SyncManagerDeps.onFirstMerge`). */
export const FIRST_SYNC_KEY = 'firstSyncVaultId'
const CHANNEL = 'notes-v2-account'

const OFF_STATUS: SyncStatus = { state: 'off', issues: [] }
// One object: `useSyncExternalStore` re-renders forever when a snapshot is a new object on every read.
const LOADING: AccountState = { status: 'loading' }

export function createUnavailableAccount(): AccountService {
  const state: AccountState = { status: 'unavailable' }
  const fail = async () => {
    throw new AuthError('unknown', 'sync is not configured')
  }
  return {
    getState: () => state,
    subscribe: () => () => {},
    init: async () => {},
    signUp: fail, signIn: fail, unlock: fail, chooseVault: fail, confirmRecoveryCode: fail, recover: fail,
    abandonVault: fail, setNewPassword: fail, requestPasswordReset: fail, signOut: fail, cancel: fail,
    prepareRecoveryCode: fail, confirmNewRecoveryCode: fail, cancelNewRecoveryCode: () => {},
    getSyncStatus: () => OFF_STATUS, subscribeSync: () => () => {}, dismissSyncIssues: () => {},
    listDevices: async () => ({ devices: [], thisDevice: '' }), renameDevice: fail, removeDevice: fail,
    close: () => {},
  }
}

export function createAccountService(deps: AccountServiceDeps): AccountService {
  let state: AccountState = { status: 'loading' }
  const listeners = new Set<() => void>()
  // Held only while a flow needs it again (choose a vault, recovery, abandon): never stored, never in `state`.
  let flow: { userId: string; email: string; password: string; pending?: PendingVault } | null = null
  let vaultForRecovery: string | null = null
  let sync: SyncHandle | null = null
  let syncing: { vaultId: string; userId: string } | null = null // what `sync` is running for
  let newCode: PendingRecoveryCode | null = null
  let closed = false
  const syncStatus = createSyncStatus({ channelFactory: deps.channelFactory })
  // Serialises actions and cross-tab re-reads so two never interleave their reads and writes of the stored account.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }

  const channel = (() => {
    try {
      return deps.channelFactory?.(CHANNEL) ?? (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL))
    } catch {
      return null
    }
  })()
  const announce = () => {
    try {
      channel?.postMessage('changed')
    } catch {
      /* the other tabs catch up on their next start */
    }
  }

  const set = (next: AccountState) => {
    state = next
    listeners.forEach((l) => l())
  }

  let deviceTimer: ReturnType<typeof setInterval> | null = null
  /** The check-in started with sync: the device list waits for it, so this device is already in it. */
  let firstCheckIn: Promise<void> = Promise.resolve()
  const stopSync = async () => {
    const s = sync
    sync = null
    syncing = null
    newCode = null
    if (deviceTimer !== null) clearInterval(deviceTimer)
    deviceTimer = null
    syncStatus.stop()
    await s?.stop()
  }
  const startSync = (vaultId: string, kek: CryptoKey, userId: string) => {
    if (closed || sync || !deps.startSync) return
    sync = deps.startSync({ vaultId, kek, report: syncStatus.start() })
    syncing = { vaultId, userId }
    if (deps.devices) {
      firstCheckIn = checkIn(userId)
      deviceTimer = setInterval(() => void checkIn(userId), deps.deviceCheckMs ?? 30 * 60 * 1000)
    }
  }

  // Registers this device / refreshes its last-seen time; a device removed from another one signs out here.
  // Offline or any other failure is ignored: device bookkeeping never gets in the way of sync.
  const thisDevice = () => deps.deviceId?.() ?? ''
  async function checkIn(userId: string): Promise<void> {
    if (!deps.devices) return
    let r: 'ok' | 'removed'
    try {
      r = await checkInDevice(deps.devices, deps.meta, { deviceId: thisDevice(), userId, name: defaultDeviceName() })
    } catch {
      return
    }
    if (r !== 'removed') return
    await serial(async () => {
      if (state.status !== 'unlocked') return
      await endSession('device-removed')
    })
  }

  async function endSession(notice?: 'device-removed'): Promise<void> {
    await stopSync()
    const email = 'email' in state ? state.email : undefined
    try {
      await deps.auth.signOut()
    } catch {
      /* offline: the local session is dropped below either way */
    }
    await deps.meta.delete(ACCOUNT_KEY)
    flow = null
    set(notice ? { status: 'signed-out', email, notice } : { status: 'signed-out', email })
    announce()
  }
  const requireDevices = () => {
    if (!deps.devices || state.status !== 'unlocked') throw new AccountError('unknown', 'not unlocked')
    return deps.devices
  }

  async function readStored(): Promise<StoredAccount | null> {
    const v = (await deps.meta.get(ACCOUNT_KEY)) as StoredAccount | undefined
    return v && typeof v.vaultId === 'string' && v.kek ? v : null
  }

  async function load(): Promise<void> {
    const [user, stored] = await Promise.all([deps.auth.getCurrentUser(), readStored()])
    if (stored && user?.userId === stored.userId) {
      // Another tab unlocked a different vault (e.g. a new one after a password reset): this tab's running sync
      // still holds the old vault's key, so it stops and starts again with the stored one (3f review A1).
      if (syncing && (syncing.vaultId !== stored.vaultId || syncing.userId !== stored.userId)) await stopSync()
      set({ status: 'unlocked', email: stored.email, vaultId: stored.vaultId })
      startSync(stored.vaultId, stored.kek, stored.userId)
      return
    }
    await stopSync()
    if (stored) {
      // The session ended (expired, or signed out elsewhere): the key goes with it; the password brings it back.
      await deps.meta.delete(ACCOUNT_KEY)
      set({ status: 'signed-out', email: stored.email })
    } else if (user) {
      if (state.status !== 'set-password') set({ status: 'locked', email: user.email })
    } else {
      set({ status: 'signed-out' })
    }
  }

  /**
   * Notes marked `synced` belong to one cloud vault. Unlocking a different one (another account on this
   * device, or a fresh vault after a lost recovery code) first clears every local `synced` flag, so notes
   * from before are never pushed into it. Only the flags change: nothing is deleted anywhere.
   */
  async function finishUnlock(userId: string, email: string, vaultId: string, kek: CryptoKey): Promise<void> {
    const deviceKek = await toDeviceKek(kek)
    const previousVault = await deps.meta.get(SYNC_VAULT_KEY)
    if (previousVault !== vaultId) {
      for (const n of deps.vault.listNotes({ includeTrashed: true })) if (n.synced) deps.vault.setNoteSynced(n.id, false, { at: null })
      await deps.vault.flushWrites()
      await deps.meta.put(SYNC_VAULT_KEY, vaultId)
      await deps.meta.put(FIRST_SYNC_KEY, vaultId)
    }
    const stored: StoredAccount = { userId, email, vaultId, kek: deviceKek }
    await deps.meta.put(ACCOUNT_KEY, stored)
    flow = null
    set({ status: 'unlocked', email, vaultId })
    announce()
    startSync(vaultId, deviceKek, userId)
  }

  async function apply(userId: string, email: string, password: string, r: ResolveResult): Promise<void> {
    switch (r.kind) {
      case 'unlocked':
        return finishUnlock(userId, email, r.vaultId, r.kek)
      case 'new-vault':
        flow = { userId, email, password, pending: r.pending }
        return set({ status: 'recovery-code', email, recoveryCode: r.pending.recoveryCode })
      case 'choose-vault':
        flow = { userId, email, password }
        return set({ status: 'choose-vault', email, vaults: r.vaults })
      case 'needs-recovery':
        flow = { userId, email, password }
        vaultForRecovery = r.vaultId
        return set({ status: 'needs-recovery', email })
    }
  }
  const requireFlow = () => {
    if (!flow) throw new AccountError('unknown', 'no account flow in progress')
    return flow
  }

  const onMessage = () => void serial(load).catch(() => {})
  channel?.addEventListener('message', onMessage)
  const offRecovery = deps.auth.onPasswordRecovery(() => {
    void serial(async () => {
      await stopSync()
      const user = await deps.auth.getCurrentUser()
      // The reset link signed this tab in as its owner; any key stored for another session is stale now.
      await deps.meta.delete(ACCOUNT_KEY)
      flow = null
      set({ status: 'set-password', email: user?.email ?? '' })
      announce() // other tabs stop syncing with the key just dropped (3f review A1)
    })
  })
  // Opening the app checks in at once (`startSync`); coming back to it (tab shown again, back online) does too,
  // so a device removed elsewhere signs out then rather than at the next timer tick.
  const onReturn = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (syncing && deps.devices) void checkIn(syncing.userId)
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onReturn)
  if (typeof window !== 'undefined') window.addEventListener('online', onReturn)

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    init: () => serial(load),
    signUp: (email, password) =>
      serial(async () => {
        const r = await registerAccount(deps.auth, email, password, { redirectTo: deps.redirectTo })
        if (r.needsConfirmation) return set({ status: 'signed-out', email, notice: 'confirm-email' })
        await apply(r.userId, email, password, await resolveVault(deps.keyStore, r.userId, password))
      }),
    signIn: (email, password) =>
      serial(async () => {
        const r = await signInAndResolve(deps, email, password)
        await apply(r.userId, email, password, r)
      }),
    unlock: (password) =>
      serial(async () => {
        const user = await deps.auth.getCurrentUser()
        if (!user) return set({ status: 'signed-out' })
        // Re-proves the password with the server too, not only against the wrapped key.
        await deps.auth.signIn(user.email, password)
        await apply(user.userId, user.email, password, await resolveVault(deps.keyStore, user.userId, password))
      }),
    chooseVault: (vaultId) =>
      serial(async () => {
        const f = requireFlow()
        await apply(f.userId, f.email, f.password, await resolveVault(deps.keyStore, f.userId, f.password, vaultId))
      }),
    confirmRecoveryCode: () =>
      serial(async () => {
        const f = requireFlow()
        if (!f.pending) throw new AccountError('unknown', 'no recovery code on screen')
        await commitVault(deps.keyStore, f.pending)
        await finishUnlock(f.userId, f.email, f.pending.vaultId, f.pending.kek)
      }),
    recover: (recoveryCode) =>
      serial(async () => {
        const f = requireFlow()
        if (!vaultForRecovery) throw new AccountError('unknown', 'no vault to recover')
        const kek = await recoverWithCode(deps.keyStore, vaultForRecovery, recoveryCode, f.password)
        await finishUnlock(f.userId, f.email, vaultForRecovery, kek)
      }),
    abandonVault: () =>
      serial(async () => {
        const f = requireFlow()
        const pending = await prepareVault(f.userId, f.password)
        flow = { ...f, pending }
        set({ status: 'recovery-code', email: f.email, recoveryCode: pending.recoveryCode })
      }),
    setNewPassword: (password) =>
      serial(async () => {
        await deps.auth.setPassword(password)
        const user = await deps.auth.getCurrentUser()
        if (!user) return set({ status: 'signed-out' })
        await apply(user.userId, user.email, password, await resolveVault(deps.keyStore, user.userId, password))
      }),
    requestPasswordReset: (email) =>
      serial(async () => {
        await requestPasswordReset(deps.auth, email, { redirectTo: deps.redirectTo })
        set({ status: 'signed-out', email, notice: 'reset-sent' })
      }),
    signOut: () => serial(() => endSession()),
    prepareRecoveryCode: (password) =>
      serial(async () => {
        if (state.status !== 'unlocked') throw new AccountError('unknown', 'not unlocked')
        newCode = await prepareRecoveryCode(deps.keyStore, state.vaultId, password)
        return newCode.recoveryCode
      }),
    confirmNewRecoveryCode: () =>
      serial(async () => {
        if (!newCode || state.status !== 'unlocked' || newCode.vaultId !== state.vaultId) throw new AccountError('unknown', 'no new recovery code')
        await commitRecoveryCode(deps.keyStore, newCode)
        newCode = null
      }),
    cancelNewRecoveryCode() {
      newCode = null
    },
    getSyncStatus: () => syncStatus.get(),
    subscribeSync: (cb) => syncStatus.subscribe(cb),
    dismissSyncIssues: () => syncStatus.dismiss(),
    listDevices: async () => {
      if (!deps.devices) return { devices: [], thisDevice: thisDevice() }
      await firstCheckIn
      return { devices: await requireDevices().list(), thisDevice: thisDevice() }
    },
    renameDevice: async (id, name) => {
      const n = name.trim()
      if (n) await requireDevices().rename(id, n)
    },
    removeDevice: async (id) => {
      if (id === thisDevice()) throw new AccountError('unknown', 'use sign out for this device')
      await requireDevices().remove(id)
    },
    cancel: () =>
      serial(async () => {
        const email = 'email' in state ? state.email : undefined
        flow = null
        vaultForRecovery = null
        try {
          await deps.auth.signOut()
        } catch {
          /* ignore */
        }
        set({ status: 'signed-out', email })
      }),
    close() {
      closed = true
      offRecovery()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onReturn)
      if (typeof window !== 'undefined') window.removeEventListener('online', onReturn)
      channel?.removeEventListener('message', onMessage)
      channel?.close()
      void stopSync()
      syncStatus.close()
    },
  }
}

/**
 * Stands in for the real service until `load` resolves, so the Supabase client (and its share of the bundle)
 * loads after the first render instead of before it. Reads as `loading` until then.
 */
export function createDeferredAccount(load: () => Promise<AccountService>): AccountService {
  let inner: AccountService | null = null
  let loading: Promise<AccountService> | null = null
  let closed = false
  const listeners = new Set<() => void>()
  const syncListeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  const get = () =>
    (loading ??= load().then((s) => {
      if (closed) s.close()
      inner = s
      s.subscribe(notify)
      s.subscribeSync(() => syncListeners.forEach((l) => l()))
      return s
    }))
  const call =
    <A extends unknown[]>(pick: (s: AccountService) => (...a: A) => Promise<void>) =>
    async (...a: A) =>
      pick(await get())(...a)
  return {
    getState: () => inner?.getState() ?? LOADING,
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    async init() {
      const s = await get()
      await s.init()
      notify()
    },
    signUp: call((s) => s.signUp),
    signIn: call((s) => s.signIn),
    unlock: call((s) => s.unlock),
    chooseVault: call((s) => s.chooseVault),
    confirmRecoveryCode: call((s) => s.confirmRecoveryCode),
    recover: call((s) => s.recover),
    abandonVault: call((s) => s.abandonVault),
    setNewPassword: call((s) => s.setNewPassword),
    requestPasswordReset: call((s) => s.requestPasswordReset),
    signOut: call((s) => s.signOut),
    cancel: call((s) => s.cancel),
    prepareRecoveryCode: async (password) => (await get()).prepareRecoveryCode(password),
    confirmNewRecoveryCode: call((s) => s.confirmNewRecoveryCode),
    cancelNewRecoveryCode: () => inner?.cancelNewRecoveryCode(),
    getSyncStatus: () => inner?.getSyncStatus() ?? OFF_STATUS,
    subscribeSync(cb) {
      syncListeners.add(cb)
      return () => void syncListeners.delete(cb)
    },
    dismissSyncIssues: () => inner?.dismissSyncIssues(),
    listDevices: async () => (await get()).listDevices(),
    renameDevice: call((s) => s.renameDevice),
    removeDevice: call((s) => s.removeDevice),
    close() {
      closed = true
      inner?.close()
    },
  }
}
