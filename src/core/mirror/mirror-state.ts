import type { NotesDb } from '@/adapters/storage/db'

export type MirrorStatus = 'off' | 'waiting' | 'active' | 'paused-permission' | 'missing-folder'

export type MirroredFile = { path: string; hash: string; mtime: number; size: number; trashed: boolean; blockIds: string[] }

/** What the app last wrote into the mirror folder (meta `mirror`); the folder handle is kept apart. */
export type MirrorState = {
  files: Record<string, MirroredFile>
  attachments: Record<string, { path: string; mtime: number; size: number }>
  /** noteId → message, after three failed tries. */
  failed: Record<string, string>
  conflicts: MirrorConflict[]
  lastWriteAt?: number
}

/** A file someone edited outside the app, kept under another name before the app wrote its version. */
export type MirrorConflict = { noteId: string; keptAs: string; at: number }

export const MIRROR_STATE_KEY = 'mirror'
export const MIRROR_HANDLE_KEY = 'mirrorHandle'
const MAX_CONFLICTS = 100

export const emptyState = (): MirrorState => ({ files: {}, attachments: {}, failed: {}, conflicts: [] })

export async function loadState(db: NotesDb): Promise<MirrorState> {
  const v = (await db.meta.get(MIRROR_STATE_KEY))?.value as MirrorState | undefined
  return v ? { ...emptyState(), ...v } : emptyState()
}

export async function saveState(db: NotesDb, s: MirrorState): Promise<void> {
  if (s.conflicts.length > MAX_CONFLICTS) s.conflicts = s.conflicts.slice(-MAX_CONFLICTS)
  await db.meta.put({ key: MIRROR_STATE_KEY, value: s })
}
