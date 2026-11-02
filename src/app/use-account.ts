import { useSyncExternalStore } from 'react'
import type { AccountService, AccountState } from './account-service'
import type { SyncStatus } from './sync-status'

export function useAccount(account: AccountService): AccountState {
  return useSyncExternalStore(account.subscribe, account.getState)
}

export function useSyncStatus(account: AccountService): SyncStatus {
  return useSyncExternalStore(account.subscribeSync, account.getSyncStatus)
}
