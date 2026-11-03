export type NoteMeta = {
  id: string
  title: string
  folderId: string | null
  order: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Phase 3 design doc §3.1: whether this note is pushed to the cloud. New notes default to false (opt-in). */
  synced: boolean
  /** When `title` was last set by a rename (absent = never renamed). Last-writer-wins key for the cloud manifest merge (3f-3). */
  titleAt?: number
  /** When `folderId`/`order` were last set by a move (absent = never moved). Same purpose as `titleAt`. */
  placeAt?: number
  /** When the note was last moved to the trash or taken out of it (absent = never). Last-writer-wins key for the trash state across devices. */
  stateAt?: number
  /** When `synced` was last switched by the user, on any device (absent = never). Decides, when the cloud lists a
   *  note this device has turned off, whether that is a newer "off" to finish or an older one the account overrode. */
  syncAt?: number
}
export type FolderMeta = {
  id: string
  name: string
  parentId: string | null
  order: string
  createdAt: number
  deletedAt: number | null
  /** When `name` was last set by a rename (absent = never). Last-writer-wins key for the cloud manifest merge (3f-3). */
  nameAt?: number
  /** When `parentId`/`order` were last set by a move (absent = never). */
  placeAt?: number
  /** When the folder was last moved to the trash or taken out of it (absent = never). */
  stateAt?: number
  /** 3f-4: notes in this folder (and its subfolders) follow cloud sync — they are synced when put or created here
   *  and unsynced when moved out. A rule of this device only: never sent to the cloud or other devices. */
  synced?: boolean
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
