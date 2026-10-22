export interface StorageAdapter {
  /** 快照（若有）在前，其後依 seq 排序的增量 */
  loadDoc(docId: string): Promise<Uint8Array[]>
  /** 回傳此文件目前增量筆數 */
  appendUpdate(docId: string, update: Uint8Array): Promise<number>
  /** 寫入快照並刪除所有增量 */
  compact(docId: string, state: Uint8Array): Promise<void>
  deleteDoc(docId: string): Promise<void>
  listDocs(): Promise<string[]>
  putBlob(id: string, blob: Blob): Promise<void>
  getBlob(id: string): Promise<Blob | undefined>
  deleteBlob(id: string): Promise<void>
}

export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown'

export class StorageError extends Error {
  kind: StorageErrorKind
  constructor(kind: StorageErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.kind = kind
  }
}

/** Maps a Dexie / IndexedDB error (or anything thrown) to a StorageError. */
export function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e
  const err = e as { name?: string; message?: string; inner?: { name?: string } } | null
  const name = err?.inner?.name ?? err?.name ?? ''
  const message = err?.message ?? String(e)
  if (name === 'QuotaExceededError') return new StorageError('quota', message, { cause: e })
  if (['DatabaseClosedError', 'OpenFailedError', 'InvalidStateError', 'SecurityError', 'MissingAPIError'].includes(name)) {
    return new StorageError('unavailable', message, { cause: e })
  }
  return new StorageError('unknown', message, { cause: e })
}
