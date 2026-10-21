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
export type AttachmentMeta = { id: string; filename: string; mimeType: string; size: number; createdAt: number }

export type VaultErrorCode = 'duplicate-title' | 'not-found' | 'cycle'
export class VaultError extends Error {
  code: VaultErrorCode
  constructor(code: VaultErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'VaultError'
    this.code = code
  }
}
