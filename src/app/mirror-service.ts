import type { NotesDb } from '@/adapters/storage/db'
import { handleDir } from '@/adapters/fs/handle-dir'
import { askPermission, canPickDirectory, permissionOf } from '@/adapters/fs/permission'
import type { StorageAdapter } from '@/adapters/storage/types'
import { onIdle } from '@/core/idle'
import type { Indexer } from '@/core/indexer/indexer'
import { Mirror, type LockLike } from '@/core/mirror/mirror'
import { emptyState, MIRROR_HANDLE_KEY, saveState, type MirrorState } from '@/core/mirror/mirror-state'
import type { TransferClient } from '@/core/transfer/transfer-client'
import type { DocIO } from '@/core/transfer/types'
import type { Vault } from '@/core/vault/vault'
import { typedWithin } from '@/features/editor/typing'

/** No file access while keys are still coming (spec 8: nothing during typing). */
const STILL_TYPING_MS = 800

export type MirrorUiStatus = 'unsupported' | 'off' | 'waiting' | 'active' | 'paused-permission' | 'missing-folder'

export type MirrorService = {
  readonly status: MirrorUiStatus
  readonly folderName: string | null
  readonly state: Readonly<MirrorState>
  subscribe(cb: () => void): () => void
  /** Startup: resumes a folder chosen earlier (asks nothing; a needed permission shows as paused). */
  init(): Promise<void>
  /** From a click: choose a folder and start. */
  choose(): Promise<void>
  /** From a click: grant access again after a browser restart. */
  resume(): Promise<void>
  stopSync(): Promise<void>
}

type PickerWindow = { showDirectoryPicker?(o?: { mode?: 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle> }

export function createMirrorService(deps: {
  vault: Vault
  db: NotesDb
  storage: StorageAdapter
  docs: DocIO
  client: TransferClient
  indexer: Pick<Indexer, 'onIndexed'>
}): MirrorService {
  const { db } = deps
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockLike }).locks : undefined
  const mirror = new Mirror({
    ...deps,
    onIndexed: (cb) => deps.indexer.onIndexed(cb),
    isTyping: () => typedWithin(STILL_TYPING_MS),
    idle: () => new Promise((r) => onIdle(() => r())),
    locks,
  })
  const listeners = new Set<() => void>()
  let handle: FileSystemDirectoryHandle | null = null
  let paused = false
  const notify = () => listeners.forEach((cb) => cb())
  mirror.subscribe(notify)

  const begin = async (h: FileSystemDirectoryHandle) => {
    handle = h
    paused = false
    await mirror.start(handleDir(h))
    notify()
  }

  return {
    get status(): MirrorUiStatus {
      if (!canPickDirectory()) return 'unsupported'
      if (paused) return 'paused-permission'
      if (!handle) return 'off'
      return mirror.status === 'off' ? 'off' : mirror.status
    },
    get folderName() {
      return handle?.name ?? null
    },
    get state() {
      return mirror.snapshot
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async init() {
      if (handle) return // already chosen in this session
      const h = (await db.meta.get(MIRROR_HANDLE_KEY))?.value as FileSystemDirectoryHandle | undefined
      if (!h || !canPickDirectory() || handle) return
      handle = h
      if ((await permissionOf(h)) === 'granted') await begin(h)
      else {
        paused = true
        notify()
      }
    },
    async choose() {
      const picker = (window as unknown as PickerWindow).showDirectoryPicker
      if (!picker) return
      let h: FileSystemDirectoryHandle
      try {
        h = await picker.call(window, { mode: 'readwrite', id: 'notes-v2-mirror' })
      } catch {
        return // cancelled
      }
      if (!(await askPermission(h))) return
      const same = handle ? await handle.isSameEntry(h).catch(() => false) : false
      await mirror.stop()
      if (!same) await saveState(db, emptyState()) // records of another folder mean nothing here
      await db.meta.put({ key: MIRROR_HANDLE_KEY, value: h })
      await begin(h)
    },
    async resume() {
      if (!handle || !(await askPermission(handle))) return
      await begin(handle)
    },
    async stopSync() {
      await mirror.stop()
      handle = null
      paused = false
      await db.meta.delete(MIRROR_HANDLE_KEY)
      await saveState(db, emptyState())
      notify()
    },
  }
}
