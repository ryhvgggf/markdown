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
 *
 * Also recovers any local edit the cloud doesn't have yet at attach time (design doc §9 "離線佇列重開機後
 * 還在") — see `recoverLocalOnlyEdits`'s own comment.
 */
export async function bindCloudDoc(doc: Y.Doc, deps: CloudDocDeps): Promise<CloudDocBinding> {
  const compactAfter = deps.compactAfter ?? DEFAULT_COMPACT_AFTER
  let closed = false

  // Design doc §9 "離線佇列重開機後還在": a restart loses the in-memory `pending` queue below, but it
  // doesn't need to survive on its own — the local Yjs doc already has every offline edit applied (it's
  // loaded from local storage before this binding attaches), so recovering them is just a one-time diff
  // against whatever the cloud actually has, computed fresh right here, not something that needs its own
  // persisted state. See `recoverLocalOnlyEdits`'s own comment for why this only runs once, at attach time.
  const localOnlyOnAttach = await recoverLocalOnlyEdits(doc, deps)

  const pending: Uint8Array[] = []
  let chain: Promise<void> = Promise.resolve()
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  // Rows pushed since the last compaction. NOT `seq` — `seq` is the server's all-time counter for this doc
  // (it keeps climbing across compactions, see `nextSeq` in supabase-sync.ts), so comparing it against
  // `compactAfter` directly would trigger a fresh full-state snapshot on every single push once past the
  // threshold once, forever. `core/persist.ts`'s equivalent resets its own counter after compacting
  // (`count = 0`); this does the same, just counting pushes locally instead of reading a count back from
  // storage. Starts at 0 even when resuming a doc that already has rows from an earlier session — a minor,
  // one-time undercount (this session won't compact until it alone has pushed `compactAfter` rows), not a
  // correctness issue: compaction here is a storage/bandwidth optimization, not something sync correctness
  // depends on.
  let pushedSinceCompaction = 0

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
        pushedSinceCompaction++
        if (pushedSinceCompaction >= compactAfter && !closed) {
          const state = await encryptDocChunk(deps.kek, deps.vaultId, deps.docId, Y.encodeStateAsUpdate(doc))
          await deps.sync.pushSnapshot(deps.vaultId, deps.docId, state, seq)
          pushedSinceCompaction = 0
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

  if (localOnlyOnAttach) {
    pending.push(localOnlyOnAttach)
    void flush()
  }

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

/**
 * Like `pullAndApply`, but also returns whatever `doc` has beyond what was just pulled — i.e. local edits
 * the cloud doesn't have yet. Only called once, at `bindCloudDoc`'s attach (not from every realtime-
 * triggered re-pull): the point is recovering edits applied while no binding existed at all (offline, or
 * before the app restarted and lost the in-memory `pending` queue), which can only be true the moment a
 * binding first attaches — after that, every local edit goes through `onUpdate`/`pending` normally and
 * doesn't need this.
 *
 * Builds the cloud's state vector from a scratch doc containing *only* what was just pulled, not from
 * `doc` after merging — merging first would make every one of `doc`'s own prior changes look like they're
 * already "in" the state vector we're about to diff against, hiding exactly the edits this exists to find.
 *
 * The returned diff is never pushed if the cloud has nothing at all yet (`pushInitialSnapshot` handles
 * that case before this binding is ever attached, design doc §8.5) — also makes the common restart case
 * ("I already have no offline edits to recover") cheap: Yjs always includes any historical delete set in
 * full regardless of the target state vector (a cheap `diff.length` check can't tell "truly nothing new"
 * from "nothing new except a doc with deletions somewhere in its history"), so this is a strictly
 * once-per-attach, not once-per-pull, cost, and still pushes an occasional harmless redundant update for a
 * doc with deletions even when nothing's actually missing — idempotent on the receiving end, same
 * trade-off this whole module already makes for remote re-pulls.
 */
async function recoverLocalOnlyEdits(doc: Y.Doc, deps: CloudDocDeps): Promise<Uint8Array | null> {
  const chunks = await deps.sync.pullDoc(deps.vaultId, deps.docId)
  if (chunks.length === 0) return null
  const decrypted = await Promise.all(chunks.map((c) => decryptDocChunk(deps.kek, deps.vaultId, deps.docId, c)))

  const cloudOnly = new Y.Doc()
  cloudOnly.transact(() => {
    for (const u of decrypted) Y.applyUpdate(cloudOnly, u)
  })
  const cloudStateVector = Y.encodeStateVector(cloudOnly)
  cloudOnly.destroy()

  doc.transact(() => {
    for (const u of decrypted) Y.applyUpdate(doc, u, CLOUD_ORIGIN)
  }, CLOUD_ORIGIN)

  const localOnly = Y.encodeStateAsUpdate(doc, cloudStateVector)
  return localOnly.length > 2 ? localOnly : null // 2 bytes ([0, 0]) is Yjs's own "nothing new" encoding
}
