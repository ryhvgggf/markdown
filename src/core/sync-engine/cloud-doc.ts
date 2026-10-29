import * as Y from 'yjs'
import { SyncError, type SyncAdapter } from '@/adapters/sync/types'
import { PERSIST_ORIGIN } from '../persist'
import { decryptDocChunk, encryptDocChunk } from './doc-crypto'

/** Origin for updates applied from the cloud — never re-pushed, mirrors `PERSIST_ORIGIN`/`TAB_ORIGIN`. */
export const CLOUD_ORIGIN: unique symbol = Symbol('cloud-sync')

/** Same backoff as local persistence (`core/persist.ts`) — no reason for the cloud to retry differently. */
export const RETRY_BACKOFF_MS = [2000, 5000, 15000, 30000, 60000]

/** Local updates are compacted into a cloud snapshot after this many pushed increments, same spirit as `bindPersistence`'s `compactAfter`. */
const DEFAULT_COMPACT_AFTER = 200

export interface CloudDocDeps {
  sync: SyncAdapter
  vaultId: string
  docId: string
  kek: CryptoKey
  deviceId: string
  compactAfter?: number
  onError?: (e: SyncError) => void
}

export interface CloudDocBinding {
  /** Stops pushing and pulling; already-queued pushes are still sent (and retried). */
  destroy(): void
  /** Resolves once every queued push has been sent, or the current attempt failed. */
  flush(): Promise<void>
  hasPending(): boolean
  isFailing(): boolean
  retry(): void
  /** Stops for good: detaches, cancels retries and the subscription, drops unsent pushes, waits for the in-flight push. */
  close(): Promise<void>
}

/**
 * Keeps one Y.Doc's content in sync with the cloud, the way `bindPersistence` keeps it in sync with local
 * storage: local edits are encrypted and pushed (queued, batched, retried with backoff), and remote changes
 * are pulled, decrypted and applied. Does **not** do the one-time initial upload for a note that just turned
 * sync on (a full-state `pushSnapshot`, design doc §8.5) — call `pushInitialSnapshot` first and attach this
 * binding only after it resolves, same as `NoteDocCache`/`Vault` only attach `bindPersistence` after the
 * doc's stored history has loaded.
 *
 * Every remote-change notification triggers a full `pullDoc` + reapply of the whole chunk list, not just
 * the new bit — simpler than tracking "how much do we already have", and correct rather than just
 * convenient: Yjs updates are idempotent, so reapplying ones already in the doc is a safe no-op, same
 * principle `tabs-bridge.ts`'s `sync-step2` already relies on.
 */
export async function bindCloudDoc(doc: Y.Doc, deps: CloudDocDeps): Promise<CloudDocBinding> {
  const compactAfter = deps.compactAfter ?? DEFAULT_COMPACT_AFTER
  let closed = false

  await pullAndApply(doc, deps)

  const pending: Uint8Array[] = []
  let chain: Promise<void> = Promise.resolve()
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleRetry = () => {
    if (closed || retryTimer !== null) return
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length - 1)]
    failures++
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flush()
    }, delay)
  }

  const drain = async () => {
    try {
      while (pending.length > 0 && !closed) {
        const n = pending.length
        const batch = n === 1 ? pending[0] : Y.mergeUpdates(pending.slice(0, n))
        const ciphertext = await encryptDocChunk(deps.kek, deps.vaultId, deps.docId, batch)
        const seq = await deps.sync.pushUpdate(deps.vaultId, deps.docId, ciphertext, deps.deviceId)
        pending.splice(0, n)
        if (seq >= compactAfter && !closed) {
          const state = await encryptDocChunk(deps.kek, deps.vaultId, deps.docId, Y.encodeStateAsUpdate(doc))
          await deps.sync.pushSnapshot(deps.vaultId, deps.docId, state, seq)
        }
      }
      failures = 0
    } catch (e) {
      deps.onError?.(e instanceof SyncError ? e : new SyncError('unknown', String(e), { cause: e }))
      if (pending.length > 0) scheduleRetry()
    }
  }
  const flush = () => (chain = chain.then(drain))

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === CLOUD_ORIGIN || origin === PERSIST_ORIGIN) return
    pending.push(update)
    void flush()
  }
  doc.on('update', onUpdate)

  const unsubscribe = deps.sync.subscribe(deps.vaultId, (change) => {
    if (closed || change.docId !== deps.docId || change.deviceId === deps.deviceId) return
    void pullAndApply(doc, deps).catch((e) => {
      deps.onError?.(e instanceof SyncError ? e : new SyncError('unknown', String(e), { cause: e }))
    })
  })

  return {
    destroy: () => {
      doc.off('update', onUpdate)
      unsubscribe()
    },
    flush,
    hasPending: () => pending.length > 0,
    isFailing: () => retryTimer !== null,
    retry() {
      if (retryTimer === null) return
      clearTimeout(retryTimer)
      retryTimer = null
      void flush()
    },
    async close() {
      closed = true
      doc.off('update', onUpdate)
      unsubscribe()
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      pending.length = 0
      await chain
    },
  }
}

/** Uploads the doc's entire current state as the initial cloud snapshot (design doc §8.5 "開啟"). Call before `bindCloudDoc`. */
export async function pushInitialSnapshot(doc: Y.Doc, deps: Omit<CloudDocDeps, 'onError' | 'compactAfter'>): Promise<void> {
  const ciphertext = await encryptDocChunk(deps.kek, deps.vaultId, deps.docId, Y.encodeStateAsUpdate(doc))
  await deps.sync.pushSnapshot(deps.vaultId, deps.docId, ciphertext, 0)
}

async function pullAndApply(doc: Y.Doc, deps: CloudDocDeps): Promise<void> {
  const chunks = await deps.sync.pullDoc(deps.vaultId, deps.docId)
  if (chunks.length === 0) return
  const decrypted = await Promise.all(chunks.map((c) => decryptDocChunk(deps.kek, deps.vaultId, deps.docId, c)))
  doc.transact(() => {
    for (const u of decrypted) Y.applyUpdate(doc, u, CLOUD_ORIGIN)
  }, CLOUD_ORIGIN)
}
