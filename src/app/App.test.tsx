import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { StorageError } from '@/adapters/storage/types'
import { App } from './App'
import { bootstrap } from './bootstrap'
import { createUnavailableAccount, type AccountService } from './account-service'
import type { SyncStatus } from './sync-status'
import { ServicesProvider } from './services-context'
import { StorageBanner } from '@/features/shell/StorageBanner'
import type { AppServices } from './bootstrap'

function fakeServices(mode: 'persistent' | 'memory') {
  let cb: ((e: StorageError) => void) | null = null
  const services = {
    storageMode: mode,
    storageErrors: { subscribe: (c: (e: StorageError) => void) => ((cb = c), () => (cb = null)) },
  } as unknown as AppServices
  return { services, emit: (e: StorageError) => cb?.(e) }
}

describe('StorageBanner', () => {
  it('shows the non-dismissible memory banner', () => {
    const { services } = fakeServices('memory')
    render(<ServicesProvider services={services}><StorageBanner /></ServicesProvider>)
    expect(screen.getByText('目前的瀏覽器模式無法保存資料，關閉視窗後內容會消失。')).toBeInTheDocument()
    expect(screen.queryByLabelText('關閉')).toBeNull()
  })
  it('shows a quota banner when emitted and can be dismissed', () => {
    const { services, emit } = fakeServices('persistent')
    render(<ServicesProvider services={services}><StorageBanner /></ServicesProvider>)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => emit(new StorageError('quota', 'full')))
    expect(screen.getByText(/儲存空間不足/)).toBeInTheDocument()
    act(() => screen.getByLabelText('關閉').click())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('App', () => {
  it('shows loading then an error with reload button', async () => {
    const boot = vi.fn().mockRejectedValue(new Error('boom'))
    render(<App boot={boot} />)
    expect(screen.getByText('正在開啟筆記…')).toBeInTheDocument()
    expect(await screen.findByText('無法開啟筆記：boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument()
  })

  it('says the note is coming from the cloud while it is still being fetched, and stops when it is here', async () => {
    const listeners = new Set<() => void>()
    let st: SyncStatus = { state: 'synced', issues: [] }
    const account: AccountService = {
      ...createUnavailableAccount(),
      getSyncStatus: () => st,
      subscribeSync: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    }
    const services = await bootstrap({ dbName: 'app-loading-hint', forceMemory: true, seedGuide: false, createAccount: () => account })
    render(<App boot={() => Promise.resolve(services)} />)
    await screen.findByLabelText('筆記標題')
    expect(screen.queryByText('正在從雲端載入…')).toBeNull()
    st = { state: 'syncing', issues: [], loading: [services.initialNoteId!] }
    act(() => listeners.forEach((l) => l()))
    expect(await screen.findByText('正在從雲端載入…')).toBeInTheDocument()
    st = { state: 'synced', issues: [] }
    act(() => listeners.forEach((l) => l()))
    expect(screen.queryByText('正在從雲端載入…')).toBeNull()
  })
})
