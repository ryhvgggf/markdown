import type { AttachmentSyncAdapter } from '@/adapters/sync/attachment-types'
import { SyncError, type SyncAdapter } from '@/adapters/sync/types'
import type { StorageAdapter } from '@/adapters/storage/types'
import { extractNote } from '@/core/extract/extract'
import type { NoteDocCache } from '@/core/note-doc/cache'
import type { Vault } from '@/core/vault/vault'
import { onIdle } from '../idle'
import { pushAttachment } from './attachment-sync'
import { bindCloudDoc, pushInitialSnapshot, type CloudDocBinding } from './cloud-doc'
import { getDeviceId } from './device-id'
import { manifestDocId, pullManifest, pushManifest } from './manifest-sync'
import { mergeManifestIntoVault } from './manifest-merge'

export interface SyncManagerDeps {
  sync: SyncAdapter
  attachmentSync: AttachmentSyncAdapter
  storage: StorageAdapter
  noteDocs: NoteDocCache
  vault: Vault
  vaultId: string
  kek: CryptoKey
  deviceId?: string
  onError?: (e: SyncError, info: { docId: string }) => void
}

export interface SyncManager {
  /**
   * Binds every already-synced note, starts watching the vault for sync/structure/content changes, and
   * pushes an up-to-date manifest once so a session that crashed before its last push still converges.
   */
  start(): Promise<void>
  /** True while any note, the manifest, or an attachment push is queued or retrying. */
  hasPending(): boolean
  /** Stops watching, closes every live binding, releases every note doc this manager acquired. */
  close(): Promise<void>
}

interface NoteBinding {
  binding: CloudDocBinding
  /** attachmentIds already pushed for this note, so an unrelated edit doesn't re-upload unchanged ones. */
  pushedAttachments: Set<string>
}

/**
 * Wires `core/sync-engine`'s pieces together for one open vault (design doc §7 `core/sync-engine`, §8.5,
 * §11 3d): live content sync for notes with `synced: true`, the cloud structure manifest kept current as
 * synced notes and their titles/folders change, and attachments pushed when a synced note first starts
 * referencing them.
 *
 * Also pulls the manifest continuously for an already-running device (the design doc only specified a
 * one-time pull for a brand-new device at login, §8; this extends it so turning sync on for a note on
 * device A makes it appear on device B without B re-logging-in): once at `start()`, and again whenever
 * the manifest doc gets a realtime notification. Merging is `manifest-merge.ts`'s job — it only ever
 * creates a note/folder id the local vault completely lacks, never touches one that's already there (see
 * its own doc comment for the settled rules, including the id-collision case reported via `onError`).
 *
 * Deliberately NOT included here — each is a separate, undecided piece of work, not an oversight:
 * - The §9 error-handling table's offline queue (surviving a restart with pushes still pending) and the
 *   "push to a doc another device deleted comes back not-found, fall back to local-only silently" case are
 *   milestone 3e ("離線佇列、...兩裝置各有本機資料的合併選擇") by the design doc's own split, not 3d.
 * - Device registration/listing (`devices` table) — the design doc flags it as deferred to 3d in
 *   `adapters/sync/types.ts`'s original comment, but §11's actual 3d bullet only names realtime sync and
 *   multi-device *verification*; building device management UI wasn't asked for here.
 */
export function createSyncManager(deps: SyncManagerDeps): SyncManager {
  const deviceId = deps.deviceId ?? getDeviceId()
  const noteBindings = new Map<string, NoteBinding>()
  let prevSyncedIds = new Set<string>()
  let unobserve: (() => void) | null = null
  let unwatchContent: (() => void) | null = null
  let unsubscribeManifest: (() => void) | null = null
  let manifestIdle: (() => void) | null = null
  let manifestMergeIdle: (() => void) | null = null
  let manifestMergeChain: Promise<void> = Promise.resolve()
  let closed = false

  const reportError = (e: unknown, docId: string) => {
    deps.onError?.(e instanceof SyncError ? e : new SyncError('unknown', String(e), { cause: e }), { docId })
  }

  const scheduleManifestPush = () => {
    if (closed || manifestIdle) return
    manifestIdle = onIdle(() => {
      manifestIdle = null
      pushManifest(deps.sync, deps.kek, deps.vaultId, deps.vault.listNotes(), deps.vault.listFolders()).catch((e) =>
        reportError(e, manifestDocId(deps.vaultId)),
      )
    })
  }

  // Pulls the cloud manifest and merges any id the local vault completely lacks into it (see the module
  // doc comment above and `manifest-merge.ts`'s own). A collision (same id, unrelated note) is reported
  // through the same `onError` channel as any other per-doc sync problem, keyed by the note's own id.
  async function pullAndMergeManifest(): Promise<void> {
    const manifest = await pullManifest(deps.sync, deps.kek, deps.vaultId)
    if (!manifest) return
    const { conflicts } = mergeManifestIntoVault(deps.vault, manifest)
    for (const conflict of conflicts) {
      const message =
        conflict.reason === 'id-collision'
          ? 'manifest note id collides with an unrelated local note (different createdAt) — left untouched'
          : 'could not create a note pulled from the manifest (e.g. its title collides with an unrelated local note) — left uncreated'
      reportError(new SyncError('unknown', message), conflict.noteId)
    }
  }

  // Debounced the same way `scheduleManifestPush` is (an idle tick, not every single notification), and
  // serialized onto its own chain so two notifications arriving close together never run the merge
  // concurrently — `pullAndMergeManifest` itself has no `await` between reading and writing vault state
  // once the pull resolves, but a second pull started before the first one's merge finishes could still
  // decide an id is "missing" based on a vault snapshot the first merge is about to change.
  const scheduleManifestMerge = () => {
    if (closed || manifestMergeIdle) return
    manifestMergeIdle = onIdle(() => {
      manifestMergeIdle = null
      manifestMergeChain = manifestMergeChain
        .then(() => pullAndMergeManifest())
        .catch((e) => reportError(e, manifestDocId(deps.vaultId)))
    })
  }

  async function pushNoteAttachments(noteId: string, nb: NoteBinding): Promise<void> {
    const doc = deps.noteDocs.peek(noteId)
    if (!doc) return
    const { attachmentIds } = extractNote(doc.getXmlFragment('content'))
    for (const attachmentId of attachmentIds) {
      if (nb.pushedAttachments.has(attachmentId)) continue
      const blob = await deps.storage.getBlob(attachmentId)
      if (!blob) continue // referenced but not stored locally (shouldn't happen; nothing to upload)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await pushAttachment(deps.attachmentSync, deps.kek, deps.vaultId, noteId, attachmentId, bytes)
      nb.pushedAttachments.add(attachmentId)
    }
  }

  async function turnOn(noteId: string): Promise<void> {
    try {
      const doc = await deps.noteDocs.acquire(noteId)
      const cloudDeps = { sync: deps.sync, vaultId: deps.vaultId, docId: noteId, kek: deps.kek, deviceId }
      // A note already uploaded in a previous session (this device crashed or restarted after turning
      // sync on but before this ran again) shouldn't be re-uploaded as a fresh snapshot — pullDoc tells us.
      const existing = await deps.sync.pullDoc(deps.vaultId, noteId)
      if (existing.length === 0) await pushInitialSnapshot(doc, cloudDeps)
      const binding = await bindCloudDoc(doc, { ...cloudDeps, onError: (e) => reportError(e, noteId) })
      const nb: NoteBinding = { binding, pushedAttachments: new Set() }
      noteBindings.set(noteId, nb)
      await pushNoteAttachments(noteId, nb)
    } catch (e) {
      deps.noteDocs.release(noteId)
      reportError(e, noteId)
    }
  }

  async function turnOff(noteId: string): Promise<void> {
    const nb = noteBindings.get(noteId)
    noteBindings.delete(noteId)
    try {
      if (nb) {
        await nb.binding.close()
        deps.noteDocs.release(noteId)
      }
      await deps.sync.deleteDoc(deps.vaultId, noteId)
      await deps.attachmentSync.deleteAttachmentsForNote(deps.vaultId, noteId)
    } catch (e) {
      reportError(e, noteId)
    }
  }

  // Per-note operation queue (design doc §9 wants a toggle-off mid-flight to end in "not synced", never
  // in a resurrected cloud doc). `turnOn`/`turnOff` are async and `onVaultChange` fires synchronously on
  // every structure change, so a note flipped synced→unsynced→synced (or the reverse) in quick succession
  // used to race: `turnOff` would run while a `turnOn` for the same note was still in flight, find no
  // `noteBindings` entry yet (so skip closing/releasing anything) but still unconditionally call
  // `sync.deleteDoc`/`deleteAttachmentsForNote` — and then the earlier `turnOn` would complete afterward,
  // register a binding, and keep pushing a note the user had already turned sync back off for, undoing the
  // delete and leaking the `NoteDocCache` ref for good (nothing left tracking it to release later).
  //
  // Fixed by never calling `turnOn`/`turnOff` directly from the diff: every change enqueues a `reconcile`
  // for that note id on a per-note promise chain, so two changes to the same note always run strictly one
  // after the other, never overlapping. `reconcile` re-reads what should currently be true (the vault's
  // live `synced` flag) and what actually is true (is there a `noteBindings` entry) right when it *runs*,
  // not what the diff looked like when it was *scheduled* — so a reconcile that was queued behind an
  // in-flight `turnOn` sees the binding that `turnOn` just registered and correctly turns it back off,
  // instead of asserting "not synced" into a `noteBindings` map that doesn't reflect reality yet.
  const noteChains = new Map<string, Promise<void>>()
  function enqueue(noteId: string, op: () => Promise<void>): void {
    const prev = noteChains.get(noteId) ?? Promise.resolve()
    noteChains.set(
      noteId,
      prev.then(op).catch((e) => reportError(e, noteId)),
    )
  }
  async function reconcile(noteId: string): Promise<void> {
    if (closed) return
    const shouldSync = deps.vault.getNote(noteId)?.synced === true
    const isBound = noteBindings.has(noteId)
    if (shouldSync && !isBound) await turnOn(noteId)
    else if (!shouldSync && isBound) await turnOff(noteId)
  }

  function onVaultChange(): void {
    const syncedIds = new Set(deps.vault.listNotes().filter((n) => n.synced).map((n) => n.id))
    const changed = new Set<string>()
    for (const id of syncedIds) if (!prevSyncedIds.has(id)) changed.add(id)
    for (const id of prevSyncedIds) if (!syncedIds.has(id)) changed.add(id)
    for (const id of changed) enqueue(id, () => reconcile(id))
    prevSyncedIds = syncedIds
    scheduleManifestPush()
  }

  function onNoteContentChange(noteId: string): void {
    const nb = noteBindings.get(noteId)
    if (!nb) return
    void pushNoteAttachments(noteId, nb).catch((e) => reportError(e, noteId))
  }

  return {
    async start() {
      // Before the observer is registered below, so the merge's own `createNote`/`setNoteSynced` calls
      // don't race `onVaultChange` — `prevSyncedIds` is computed fresh right after and already covers
      // whatever this pass just merged in, same as it covers notes synced on this device in a past session.
      await pullAndMergeManifest()

      prevSyncedIds = new Set(deps.vault.listNotes().filter((n) => n.synced).map((n) => n.id))
      for (const id of prevSyncedIds) await turnOn(id)

      // Preferences (design doc §5 open decision 5: always synced once enabled, no per-note on/off) isn't
      // wired in here — this manager takes a `Vault`, not a `Preferences` instance. A caller that has both
      // can bind the preferences doc itself with `bindCloudDoc(prefsDoc, { ...cloudDeps, docId:
      // \`${vaultId}-prefs\` })` directly; no initial-snapshot gate needed since there's no user toggle to
      // wait for, it can just start accumulating updates like any other live binding.

      unobserve = deps.vault.observe(onVaultChange)
      unwatchContent = deps.noteDocs.onChange((noteId) => onNoteContentChange(noteId))
      // The manifest doc's own pushes (ours and everyone else's) notify with `deviceId: ''` (design doc
      // §3.1's manifest predates per-device echo filtering — see `cloud-doc.ts`'s subscribe for the
      // contrast). So this can't tell "I just pushed this" from "someone else did" by deviceId the way a
      // per-note binding does — but it doesn't need to: re-merging a manifest this very device just
      // derived from its own local state is always a complete no-op (every id in it already exists
      // locally, that's what "derived from" means), just a wasted pull. Not worth the bookkeeping to skip.
      unsubscribeManifest = deps.sync.subscribe(deps.vaultId, (change) => {
        if (change.docId === manifestDocId(deps.vaultId)) scheduleManifestMerge()
      })
      scheduleManifestPush()
    },

    hasPending() {
      if (manifestIdle !== null || manifestMergeIdle !== null) return true
      for (const nb of noteBindings.values()) if (nb.binding.hasPending()) return true
      return false
    },

    async close() {
      // `manifestMergeIdle?.()` only cancels a merge that hasn't started yet. One already past that point —
      // its idle callback fired and chained `pullAndMergeManifest` onto `manifestMergeChain` — is already
      // running and can't be cancelled, so it has to be awaited here. Crucially, this has to happen *before*
      // `closed` is set and `unobserve()` runs: that merge's own `createNote`/`setNoteSynced` calls only
      // reach `onVaultChange` (hence `enqueue`/`reconcile`/`turnOn`) while the observer is attached AND
      // `reconcile`'s own `if (closed) return` guard (below) hasn't tripped yet. Get either order wrong —
      // await after `unobserve()`, or after `closed = true` — and the merge itself still finishes (the note
      // ends up created and `synced: true`), but nothing ever calls `turnOn` for it this session: it sits
      // flagged synced but never actually bound to live content sync until the next `start()` quietly
      // catches it. `unsubscribeManifest` goes first just to stop any *further* notification from
      // scheduling another merge while this one is still being waited on.
      const cancelManifestIdle = () => {
        manifestIdle?.()
        manifestIdle = null
      }
      unsubscribeManifest?.()
      unsubscribeManifest = null
      manifestMergeIdle?.()
      manifestMergeIdle = null
      cancelManifestIdle()
      await manifestMergeChain
      await Promise.all(noteChains.values()) // whatever that merge's own onVaultChange just enqueued (e.g. turnOn for the merged note)
      cancelManifestIdle() // onVaultChange above also calls scheduleManifestPush unconditionally — cancel that too

      closed = true
      unobserve?.()
      unobserve = null
      unwatchContent?.()
      unwatchContent = null
      // Let every already-queued reconcile finish first (a not-yet-started one bails out immediately via
      // `reconcile`'s own `closed` check; one already mid-`turnOn`/`turnOff` still needs to run to
      // completion) — otherwise closing `noteBindings` here and having `turnOn` register one into it a
      // moment later would leak exactly the binding + unreleased `NoteDocCache` ref this is meant to avoid.
      await Promise.all(noteChains.values())
      await Promise.all(
        [...noteBindings.entries()].map(async ([noteId, nb]) => {
          await nb.binding.close()
          deps.noteDocs.release(noteId)
        }),
      )
      noteBindings.clear()
    },
  }
}
