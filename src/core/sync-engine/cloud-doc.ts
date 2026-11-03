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
  /** What the caller just pulled for this doc, so attaching doesn't pull it a second time. */
  initialChunks?: Uint8Array[]
  /**
   * For note docs: when the cloud copy and this device's copy have nothing in common (the same note was made
   * separately on each device, e.g. by importing the same export twice) and both have content, merging them
   * would write the content twice. So one of them replaces the other, as a whole: the same text → the cloud
   * copy stays; different → `localWins()` (the more recently edited one wins) decides whether this device's
   * copy replaces the cloud's or the other way round. A device already bound when the cloud copy gets replaced
   * simply adopts the new one (the replacing device already made the decision).
   */
  reconcileUnrelated?: { fragment: string; localWins: () => Promise<boolean> }
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
  /** Pulls the cloud copy and applies it now, as a realtime notification would (used after missed notifications). */
  resync(): Promise<void>
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

  const pull = () =>
    closed
      ? Promise.resolve()
      : pullAndApply(doc, deps, pending, (diff) => {
          pending.push(diff)
          void flush()
        }).catch((e) => {
          deps.onError?.(e instanceof SyncError ? e : new SyncError('unknown', String(e), { cause: e }))
        })
  const unsubscribe = deps.sync.subscribe(deps.vaultId, (change) => {
    if (closed || change.docId !== deps.docId || change.deviceId === deps.deviceId) return
    void pull()
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
    resync: pull,
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

/** True when the two state vectors have an author (Yjs client) in common, i.e. the docs descend from one another. */
function shareHistory(a: Uint8Array, b: Uint8Array): boolean {
  const other = Y.decodeStateVector(b)
  for (const client of Y.decodeStateVector(a).keys()) if (other.has(client)) return true
  return false
}

/** The content as text, without block ids (two separately made copies of one note differ only in those). */
function shapeOf(fragment: Y.XmlFragment): string {
  return fragment.toString().replace(/\s+id="[^"]*"/g, '')
}

async function pullAndApply(
  doc: Y.Doc,
  deps: CloudDocDeps,
  unsent: readonly Uint8Array[],
  onAdopted: (localDiff: Uint8Array) => void,
): Promise<void> {
  const chunks = await deps.sync.pullDoc(deps.vaultId, deps.docId)
  if (chunks.length === 0) return
  const decrypted = await Promise.all(chunks.map((c) => decryptDocChunk(deps.kek, deps.vaultId, deps.docId, c)))
  const cfg = deps.reconcileUnrelated
  if (cfg) {
    const cloudOnly = scratchDoc(decrypted)
    if (isUnrelated(doc, cloudOnly, cfg.fragment)) {
      // The cloud copy was replaced by another device's: take it on as a whole. This device's items stay as
      // deleted ones and are pushed, so edits made here from now on connect to their history.
      //
      // Except edits this device made without knowing about the replacement (3f review B3): ones it pushed onto
      // the new cloud copy (the cloud can't place them — they build on history it no longer has) and ones not
      // sent yet. Those are the newest edits anywhere, so their blocks are carried over into the adopted copy.
      const carried = blocksMadeIn(doc.getXmlFragment(cfg.fragment), orphanRanges(cloudOnly, unsent))
      const diff = adoptCloudCopy(doc, cloudOnly, decrypted, cfg.fragment)
      cloudOnly.destroy()
      if (diff) onAdopted(diff)
      if (carried.length > 0) {
        const f = doc.getXmlFragment(cfg.fragment)
        doc.transact(() => {
          for (const c of carried) f.insert(Math.min(c.index, f.length), [c.block])
        }) // a local edit: pushed like any other
      }
      return
    }
    cloudOnly.destroy()
  }
  doc.transact(() => {
    for (const u of decrypted) Y.applyUpdate(doc, u, CLOUD_ORIGIN)
  }, CLOUD_ORIGIN)
}

type Ranges = Map<number, Array<[number, number]>> // client → [from, to) clock ranges

/** What this device wrote that the cloud copy can't place (pushed onto a replaced copy), plus what is still unsent. */
function orphanRanges(cloud: Y.Doc, unsent: readonly Uint8Array[]): Ranges {
  const out: Ranges = new Map()
  const add = (update: Uint8Array, v2 = false) => {
    const { from, to } = v2 ? Y.parseUpdateMetaV2(update) : Y.parseUpdateMeta(update)
    for (const [client, start] of from) {
      const end = to.get(client) ?? start
      if (end > start) out.set(client, [...(out.get(client) ?? []), [start, end]])
    }
  }
  const pendingUpdate = cloud.store.pendingStructs?.update
  if (pendingUpdate) add(pendingUpdate, true) // Yjs keeps these in its v2 encoding
  for (const u of unsent) add(u)
  return out
}

/** Top-level blocks holding any live item in `ranges`, cloned with their index (taken before the fragment is cleared). */
function blocksMadeIn(fragment: Y.XmlFragment, ranges: Ranges): Array<{ index: number; block: Y.XmlElement | Y.XmlText }> {
  if (ranges.size === 0) return []
  const hit = (id: Y.ID, length: number) =>
    (ranges.get(id.client) ?? []).some(([from, to]) => id.clock < to && id.clock + length > from)
  const touches = (t: Y.AbstractType<unknown>): boolean => {
    for (let i = t._start; i !== null; i = i.right) {
      if (i.deleted) continue
      if (hit(i.id, i.length)) return true
      if (i.content instanceof Y.ContentType && touches(i.content.type)) return true
    }
    return false
  }
  const out: Array<{ index: number; block: Y.XmlElement | Y.XmlText }> = []
  fragment.toArray().forEach((b, index) => {
    if (!(b instanceof Y.XmlElement || b instanceof Y.XmlText)) return
    const item = b._item
    if ((item && hit(item.id, 1)) || touches(b as Y.AbstractType<unknown>)) out.push({ index, block: b.clone() })
  })
  return out
}

function scratchDoc(updates: Uint8Array[]): Y.Doc {
  const d = new Y.Doc()
  d.transact(() => {
    for (const u of updates) Y.applyUpdate(d, u)
  })
  return d
}

/** Both copies have content and share no author: the same note made separately, not two edits of one. */
function isUnrelated(local: Y.Doc, cloud: Y.Doc, fragment: string): boolean {
  return (
    local.getXmlFragment(fragment).length > 0 &&
    cloud.getXmlFragment(fragment).length > 0 &&
    !shareHistory(Y.encodeStateVector(local), Y.encodeStateVector(cloud))
  )
}

/**
 * Makes `doc` the cloud copy: its own content is deleted and the cloud's comes in. Returns what the cloud
 * doesn't have yet (this device's deleted items — they carry no content, but later edits here build on them,
 * and without them other devices could never apply those edits), or null when there is none.
 */
function adoptCloudCopy(doc: Y.Doc, cloud: Y.Doc, updates: Uint8Array[], fragment: string): Uint8Array | null {
  const local = doc.getXmlFragment(fragment)
  doc.transact(() => {
    local.delete(0, local.length)
    for (const u of updates) Y.applyUpdate(doc, u, CLOUD_ORIGIN)
  }, CLOUD_ORIGIN)
  const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(cloud))
  return diff.length > 2 ? diff : null
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
  const chunks = deps.initialChunks ?? (await deps.sync.pullDoc(deps.vaultId, deps.docId))
  if (chunks.length === 0) return null
  const decrypted = await Promise.all(chunks.map((c) => decryptDocChunk(deps.kek, deps.vaultId, deps.docId, c)))

  const cloudOnly = scratchDoc(decrypted)
  const cloudStateVector = Y.encodeStateVector(cloudOnly)

  const cfg = deps.reconcileUnrelated
  if (cfg && isUnrelated(doc, cloudOnly, cfg.fragment)) {
    const same = shapeOf(doc.getXmlFragment(cfg.fragment)) === shapeOf(cloudOnly.getXmlFragment(cfg.fragment))
    if (same || !(await cfg.localWins())) {
      const diff = adoptCloudCopy(doc, cloudOnly, decrypted, cfg.fragment)
      cloudOnly.destroy()
      return diff
    }
    // This device's copy is the newer one: it replaces the cloud's, whole. Devices bound to the old one adopt it.
    cloudOnly.destroy()
    await deps.sync.deleteDoc(deps.vaultId, deps.docId)
    await deps.sync.pushSnapshot(deps.vaultId, deps.docId, await encryptDocChunk(deps.kek, deps.vaultId, deps.docId, Y.encodeStateAsUpdate(doc)), 0)
    return null
  }
  cloudOnly.destroy()

  doc.transact(() => {
    for (const u of decrypted) Y.applyUpdate(doc, u, CLOUD_ORIGIN)
  }, CLOUD_ORIGIN)

  const localOnly = Y.encodeStateAsUpdate(doc, cloudStateVector)
  return localOnly.length > 2 ? localOnly : null // 2 bytes ([0, 0]) is Yjs's own "nothing new" encoding
}
