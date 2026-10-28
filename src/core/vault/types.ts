export type NoteMeta = {
  id: string
  title: string
  folderId: string | null
  order: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}
export type FolderMeta = {
  id: string
  name: string
  parentId: string | null
  order: string
  createdAt: number
  deletedAt: number | null
}
export type AttachmentMeta = {
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt: number
  /** Non-null: in the trash (moved there by the user); emptied 30 days later like notes. */
  deletedAt: number | null
  /** Last time it was restored from the trash (absent if never). */
  restoredAt?: number
}

export type VaultErrorCode = 'duplicate-title' | 'not-found' | 'cycle' | 'exists'
export class VaultError extends Error {
  code: VaultErrorCode
  constructor(code: VaultErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'VaultError'
    this.code = code
  }
}
