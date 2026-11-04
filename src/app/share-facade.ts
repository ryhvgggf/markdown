import type { NotesDb } from '@/adapters/storage/db'
import { REMOVE_BATCH, ShareError, type ShareAdapter } from '@/adapters/share/types'
import { createShareService, type ShareAccount, type ShareService } from '@/core/share/share-service'
import { ACCOUNT_KEY, SYNC_VAULT_KEY, type StoredAccount } from './account-service'

/** db.meta: ids of permanently deleted notes whose links could not be stopped yet (signed out or offline). */
export const PENDING_SHARE_REMOVALS_KEY = 'pendingShareRemovals'

/**
 * What the app uses for sharing: a `ShareService` on the account stored on this device, plus the clean-up of
 * links when a note is deleted for good. A removal that cannot happen now (signed out, offline) is kept in
 * `db.meta` and retried by `flushPending` (on start and after sign-in), so a link never outlives its note.
 */
export interface ShareFacade {
  /** Runs `fn` with the share service; `ShareError('unavailable')` in a build without cloud, `'signed-out'` without an account on this device. */
  run<T>(fn: (s: ShareService) => Promise<T>): Promise<T>
  /** Permanently deleted notes: stops their links now, or queues them. Never rejects. */
  noteRemoved(noteIds: string[]): Promise<void>
  /** Retries the queued removals (needs an account). Never rejects. */
  flushPending(): Promise<void>
}

export function createShareFacade(deps: {
  db: NotesDb
  /** The storage behind the links; null when sharing is not configured (local-only build). */
  adapter: (() => Promise<ShareAdapter>) | null
  origin: string | (() => string)
  /** Replaces the account stored on this device (e2e). */
  account?: () => Promise<ShareAccount | null>
}): ShareFacade {
  const { db } = deps
  let adapterP: Promise<ShareAdapter> | null = null
  const adapter = () => {
    if (!deps.adapter) throw new ShareError('unavailable', 'sharing is not configured')
    return (adapterP ??= deps.adapter())
  }
  const account = async (): Promise<ShareAccount | null> => {
    if (deps.account) return deps.account()
    const v = (await db.meta.get(ACCOUNT_KEY))?.value as StoredAccount | undefined
    return v?.kek && v.userId && v.vaultId ? { userId: v.userId, vaultId: v.vaultId, kek: v.kek } : null
  }
  const service = async (): Promise<ShareService> => {
    if (!deps.adapter) throw new ShareError('unavailable', 'sharing is not configured')
    const a = await account()
    if (!a) throw new ShareError('signed-out')
    return createShareService({ adapter: await adapter(), account: () => a, origin: typeof deps.origin === 'function' ? deps.origin() : deps.origin })
  }

  const readPending = async (): Promise<string[]> => {
    const v = (await db.meta.get(PENDING_SHARE_REMOVALS_KEY))?.value
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  const writePending = async (fn: (ids: string[]) => string[]): Promise<void> => {
    await db.transaction('rw', db.meta, async () => {
      const after = fn(await readPending())
      if (after.length) await db.meta.put({ key: PENDING_SHARE_REMOVALS_KEY, value: after })
      else await db.meta.delete(PENDING_SHARE_REMOVALS_KEY)
    })
  }

  let flushing: Promise<void> | null = null
  const flushOnce = async (): Promise<void> => {
    let svc: ShareService
    try {
      svc = await service()
    } catch {
      return // signed out: stays queued
    }
    const pending = await readPending()
    for (let i = 0; i < pending.length; i += REMOVE_BATCH) {
      const batch = pending.slice(i, i + REMOVE_BATCH)
      try {
        await svc.removeForNotes(batch)
      } catch (e) {
        console.warn('[share]', e)
        continue // offline or failed: stays queued
      }
      await writePending((ids) => ids.filter((x) => !batch.includes(x)))
    }
  }

  const facade: ShareFacade = {
    run: async (fn) => fn(await service()),
    async noteRemoved(noteIds) {
      if (!noteIds.length || !deps.adapter) return
      // A device that never signed in cannot have made a link, so there is nothing to stop (and nothing to queue).
      try {
        if (!(await db.meta.get(SYNC_VAULT_KEY))?.value) return
      } catch {
        return
      }
      try {
        await writePending((ids) => [...new Set([...ids, ...noteIds])])
      } catch (e) {
        console.warn('[share]', e)
        return
      }
      await facade.flushPending()
    },
    flushPending() {
      if (!deps.adapter) return Promise.resolve()
      // One pass at a time; a request that arrives meanwhile runs another pass afterwards.
      flushing = (flushing ?? Promise.resolve()).then(flushOnce).catch((e) => console.warn('[share]', e))
      return flushing
    },
  }
  return facade
}
