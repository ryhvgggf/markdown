import type { AttachmentSyncAdapter } from '@/adapters/sync/attachment-types'
import { SyncError, type SyncAdapter } from '@/adapters/sync/types'
import type { StorageAdapter } from '@/adapters/storage/types'
import { extractNote } from '@/core/extract/extract'
import type { NoteDocCache } from '@/core/note-doc/cache'
import * as Y from 'yjs'
import { dedupeTitle } from '@/core/vault/titles'
import type { Vault } from '@/core/vault/vault'
import type { Preferences } from '@/core/preferences/preferences'
import { bindPrefsSync, type PrefsSyncBinding } from './prefs-sync'
import { onIdle } from '../idle'
import { pullAttachment, pushAttachment } from './attachment-sync'
import { bindCloudDoc, pushInitialSnapshot, type CloudDocBinding } from './cloud-doc'
import { getDeviceId } from './device-id'
import { manifestDocId, pullManifest, pushManifest } from './manifest-sync'
import { deriveManifest, type StructureManifest } from './manifest'
import { cloudIsBehind, combineManifests, mergeManifestIntoVault, missingAttachments } from './manifest-merge'
import type { AttachmentMeta } from '@/core/vault/types'

export interface SyncManagerDeps {
  sync: SyncAdapter
  attachmentSync: AttachmentSyncAdapter
  storage: StorageAdapter
  noteDocs: NoteDocCache
  vault: Vault
  /** Appearance settings to keep in step with the account (3f-4); left out → not synced. */
  prefs?: Preferences
  vaultId: string
  kek: CryptoKey
  deviceId?: string
  /** The note open on screen: on start its content is fetched first. */
  priorityNoteId?: () => string | null
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
 * Also pulls the manifest continuously for an already-running device: once at `start()`, and again whenever
 * the manifest doc gets a realtime notification. Merging is `manifest-merge.ts`'s job: it creates what the
 * local vault lacks and, since 3f-3, applies newer titles/placements (last-writer-wins per field) to notes
 * already synced here; pushes combine with the cloud copy the same way (`combineManifests`). Attachments
 * another device synced are downloaded in the background, their metadata travelling in the manifest.
 *
 * Device registration (`devices` table) lives in the account layer (`core/account/devices.ts`), not here.
 */
/** How many notes are brought up to date at once when sync starts. */
const INITIAL_SYNC_PARALLEL = 6

export function createSyncManager(deps: SyncManagerDeps): SyncManager {
  const deviceId = deps.deviceId ?? getDeviceId()
  const noteBindings = new Map<string, NoteBinding>()
  let prevSyncedIds = new Set<string>()
  let unobserve: (() => void) | null = null
  let unwatchContent: (() => void) | null = null
  let unwatchPurge: (() => void) | null = null
  let unsubscribeManifest: (() => void) | null = null
  let manifestIdle: (() => void) | null = null
  let manifestMergeIdle: (() => void) | null = null
  let manifestMergeChain: Promise<void> = Promise.resolve()
  let closed = false
  let prefsBinding: PrefsSyncBinding | null = null

  // Ids this device has deliberately told the cloud to delete this session (an explicit `setNoteSynced`
  // toggle-off, or a `Vault.onNotePurged` permanent delete — see `turnOff`). The ONLY ids a manifest push
  // is allowed to drop relative to what the cloud already has: a note missing from the local vault for any
  // other reason (a bug, corrupted storage, a bad undo — exactly today's incident) must not look like a
  // delete just because a live scan of the local vault no longer finds it.
  const deliberatelyRemoved = new Map<string, number>() // id → when; also becomes the manifest's removal mark
  // Notes the user turned sync back on this session: a removal mark another device left for them is stale.
  const resynced = new Set<string>()
  // Notes another device removed from the cloud and the merge just unsynced here: closed without touching the cloud.
  const remotelyRemoved = new Set<string>()
  // Removal marks this device saw reach the cloud. Once the cloud manifest loses one of them, someone synced
  // that note again, so this device's own removal is over and must not be re-marked.
  const confirmedMarks = new Set<string>()
  let merging = false // true while a pulled manifest is being applied: vault changes then are not the user's

  const reportError = (e: unknown, docId: string) => {
    deps.onError?.(e instanceof SyncError ? e : new SyncError('unknown', String(e), { cause: e }), { docId })
  }

  // A snapshot overwrite, but merged against the cloud's current manifest rather than blindly replacing it:
  // anything the cloud already lists that this device's local vault doesn't currently have is carried over
  // unchanged, unless it's in `deliberatelyRemoved` — so a note that merely vanished locally (never an
  // intentional delete) keeps its cloud copy and its place in the manifest, recoverable once the real cause
  // is fixed, instead of being wiped out the next time anything else triggers a manifest push.
  //
  // Since 3f-3 the merge is also field-level last-writer-wins for records both sides have (see
  // `combineManifests`), so a rename made on another device that this one hasn't pulled yet isn't
  // overwritten with this device's older title.
  async function pushMergedManifest(): Promise<void> {
    const cloud = await pullManifest(deps.sync, deps.kek, deps.vaultId).catch(() => null)
    const c = combineManifests(localView(), cloud, { removed: deliberatelyRemoved, resynced, now: Date.now() })
    await pushManifest(deps.sync, deps.kek, deps.vaultId, c.notes, c.folders, c.attachments, c.removed)
    for (const r of c.removed) if (deliberatelyRemoved.has(r.id)) confirmedMarks.add(r.id)
  }

  /** This device's contribution to the manifest: its notes and folders, and the metadata of attachments its synced notes use in the cloud. */
  function localView() {
    const attachments: AttachmentMeta[] = []
    const seen = new Set<string>()
    for (const nb of noteBindings.values()) {
      for (const id of nb.pushedAttachments) {
        const a = seen.has(id) ? undefined : deps.vault.getAttachment(id)
        seen.add(id)
        if (a) attachments.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt, deletedAt: null })
      }
    }
    return { notes: deps.vault.listNotes(), folders: deps.vault.listFolders(), attachments }
  }

  const scheduleManifestPush = () => {
    if (closed || manifestIdle) return
    manifestIdle = onIdle(() => {
      manifestIdle = null
      pushMergedManifest().catch((e) => reportError(e, manifestDocId(deps.vaultId)))
    })
  }

  // Pulls the cloud manifest and merges any id the local vault completely lacks into it (see the module
  // doc comment above and `manifest-merge.ts`'s own). A collision (same id, unrelated note) is reported
  // through the same `onError` channel as any other per-doc sync problem, keyed by the note's own id.
  async function pullAndMergeManifest(): Promise<void> {
    const confirmedBefore = [...confirmedMarks] // a mark confirmed while this pull was in flight can't be judged by it
    const manifest = await pullManifest(deps.sync, deps.kek, deps.vaultId)
    if (!manifest) return
    merging = true
    let conflicts
    try {
      ;({ conflicts } = mergeManifestIntoVault(deps.vault, manifest, { resynced, onRemotelyRemoved: (id) => remotelyRemoved.add(id) }))
    } finally {
      merging = false
    }
    const marked = new Set((manifest.removed ?? []).map((r) => r.id))
    for (const id of [...resynced]) if (!marked.has(id)) resynced.delete(id) // the mark is gone: no longer needs overriding
    for (const id of confirmedBefore) {
      if (marked.has(id)) continue
      confirmedMarks.delete(id) // the note was synced again elsewhere: our removal is over
      deliberatelyRemoved.delete(id)
    }
    for (const conflict of conflicts) {
      const message =
        conflict.reason === 'id-collision'
          ? 'manifest note id collides with an unrelated local note (different createdAt) — left untouched'
          : 'could not create a note pulled from the manifest (e.g. its folder could not be created) — left uncreated'
      reportError(new SyncError('conflict', message), conflict.noteId)
    }
    downloadAttachments(manifest)
    // Another device's push may have raced ours and dropped something this device contributed: push again.
    const view = localView()
    const derived = { ...deriveManifest(view.notes, view.folders), attachments: view.attachments }
    if (!closed && cloudIsBehind(derived, manifest, deliberatelyRemoved.keys())) scheduleManifestPush()
  }

  // Attachments other devices synced (3f-3): the bytes are downloaded and stored before the metadata is
  // added, so a note never shows an attachment as "ready" whose bytes aren't here yet. Sequential, in the
  // background (not blocking `start()`); a failure is reported and retried on the next manifest pull.
  const downloading = new Set<string>()
  const notInCloud = new Set<string>() // downloadAttachment said null: don't ask again this session
  let downloadChain: Promise<void> = Promise.resolve()
  function downloadAttachments(manifest: StructureManifest): void {
    for (const a of missingAttachments(deps.vault, manifest)) {
      if (downloading.has(a.id) || notInCloud.has(a.id)) continue
      downloading.add(a.id)
      downloadChain = downloadChain
        .then(async () => {
          if (closed || deps.vault.getAttachment(a.id)) return
          const bytes = await pullAttachment(deps.attachmentSync, deps.kek, deps.vaultId, a.id)
          if (!bytes) return void notInCloud.add(a.id)
          await deps.storage.putBlob(a.id, new Blob([bytes as BlobPart], { type: a.mimeType }))
          if (!deps.vault.getAttachment(a.id)) {
            deps.vault.addAttachment({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt })
          }
        })
        .catch((e) => reportError(e, manifestDocId(deps.vaultId))) // shown as a problem with the note list
        .finally(() => downloading.delete(a.id))
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
    let pushed = false
    for (const attachmentId of attachmentIds) {
      if (nb.pushedAttachments.has(attachmentId)) continue
      const blob = await deps.storage.getBlob(attachmentId)
      if (!blob) continue // not stored locally (e.g. still downloading from another device's upload): nothing to upload
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await pushAttachment(deps.attachmentSync, deps.kek, deps.vaultId, noteId, attachmentId, bytes)
      nb.pushedAttachments.add(attachmentId)
      pushed = true
    }
    if (pushed) scheduleManifestPush() // its metadata goes into the manifest, so other devices can show it
  }

  /**
   * The cloud's copy of a note replaced this device's differing copy (they were made separately, so they can't
   * be merged): the device's version is kept as a new, unsynced note next to it.
   */
  async function keepLocalVersion(noteId: string, state: Uint8Array): Promise<void> {
    const original = deps.vault.getNote(noteId)
    if (!original) return
    const taken = new Set(deps.vault.listNotes({ includeTrashed: true }).map((n) => n.title))
    const copy = deps.vault.createNote({ title: dedupeTitle(`${original.title.trim() || '未命名'}（本機版本）`, taken), folderId: original.folderId })
    if (copy.synced) deps.vault.setNoteSynced(copy.id, false) // a synced folder would otherwise upload the copy
    const doc = await deps.noteDocs.acquire(copy.id)
    try {
      Y.applyUpdate(doc, state)
    } finally {
      deps.noteDocs.release(copy.id)
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
      // Attachments the cloud already holds for this note (uploaded by any device) aren't uploaded again.
      const inCloud = existing.length === 0 ? [] : await deps.attachmentSync.listAttachments(deps.vaultId, noteId)
      const binding = await bindCloudDoc(doc, {
        ...cloudDeps,
        initialChunks: existing.length > 0 ? existing : undefined,
        adoptCloudIfUnrelated: { fragment: 'content', onLocalDiverged: (state) => void keepLocalVersion(noteId, state).catch((e) => reportError(e, noteId)) },
        onError: (e) => reportError(e, noteId),
      })
      const nb: NoteBinding = { binding, pushedAttachments: new Set(inCloud) }
      noteBindings.set(noteId, nb)
      await pushNoteAttachments(noteId, nb)
    } catch (e) {
      deps.noteDocs.release(noteId)
      reportError(e, noteId)
    }
  }

  /** A deliberate stop: closes the binding (if any) and tells the cloud to delete this note's content —
   * for an explicit `setNoteSynced(false)` toggle or a `Vault.onNotePurged` permanent delete only. */
  async function turnOff(noteId: string): Promise<void> {
    deliberatelyRemoved.set(noteId, Date.now())
    resynced.delete(noteId)
    scheduleManifestPush() // the removal mark goes up with the next manifest
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

  /** Stops actively syncing a note this device can no longer find locally, WITHOUT telling the cloud to
   * delete anything — see `reconcile`'s own comment for when this runs instead of `turnOff`. */
  async function detachOnly(noteId: string): Promise<void> {
    const nb = noteBindings.get(noteId)
    noteBindings.delete(noteId)
    if (!nb) return
    try {
      await nb.binding.close()
      deps.noteDocs.release(noteId)
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
    const note = deps.vault.getNote(noteId)
    const isBound = noteBindings.has(noteId)
    if (note === undefined) {
      // Gone from the local vault with no explicit purge notification — could just as easily be a bug or
      // local data loss as a real delete (see `pushMergedManifest`'s comment), so never infer a cloud
      // deletion from this alone. Just stop actively pushing/pulling it on this device; `onNotePurged`
      // (wired in `start()`) is the only path that actually calls `turnOff` for a permanent delete.
      if (isBound) await detachOnly(noteId)
      return
    }
    const shouldSync = note.synced === true
    if (shouldSync && !isBound) await turnOn(noteId)
    else if (!shouldSync && isBound) {
      // Another device removed it: stop here too, but never touch the cloud (it is already gone, or re-synced since).
      if (remotelyRemoved.delete(noteId)) await detachOnly(noteId)
      else await turnOff(noteId) // explicit setNoteSynced(false)
    } else remotelyRemoved.delete(noteId)
  }

  function onVaultChange(): void {
    const syncedIds = new Set(deps.vault.listNotes().filter((n) => n.synced).map((n) => n.id))
    const changed = new Set<string>()
    for (const id of syncedIds) {
      if (prevSyncedIds.has(id)) continue
      changed.add(id)
      remotelyRemoved.delete(id)
      if (!merging) {
        // The user synced this note (again) on this device: any removal mark, ours or another device's, is stale.
        deliberatelyRemoved.delete(id)
        confirmedMarks.delete(id)
        resynced.add(id)
      }
    }
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
      remotelyRemoved.clear() // nothing is bound yet, so nothing needs the detach-only treatment

      prevSyncedIds = new Set(deps.vault.listNotes().filter((n) => n.synced).map((n) => n.id))
      // Several notes at once (each needs a few round trips; one after another a big vault took minutes to
      // arrive on a new device), the one on screen first.
      const open = deps.priorityNoteId?.() ?? null
      const ids = [...prevSyncedIds].sort((a, b) => Number(b === open) - Number(a === open))
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(INITIAL_SYNC_PARALLEL, ids.length) }, async () => {
          while (next < ids.length) await turnOn(ids[next++])
        }),
      )

      // Appearance settings (design doc §5 open decision 5: always synced once signed in, no per-note on/off).
      if (deps.prefs) {
        try {
          prefsBinding = await bindPrefsSync(deps.prefs, { sync: deps.sync, vaultId: deps.vaultId, kek: deps.kek, deviceId, onError: (e) => reportError(e, `${deps.vaultId}-prefs`) })
        } catch (e) {
          reportError(e, `${deps.vaultId}-prefs`) // never blocks the notes from syncing
        }
      }

      unobserve = deps.vault.observe(onVaultChange)
      unwatchContent = deps.noteDocs.onChange((noteId) => onNoteContentChange(noteId))
      // The one explicit "really gone, on purpose" signal (see `reconcile`'s comment) — a permanent
      // delete should still delete the cloud copy, even though a note merely vanishing otherwise must not.
      unwatchPurge = deps.vault.onNotePurged((noteId) => enqueue(noteId, () => turnOff(noteId)))
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
      if (manifestIdle !== null || manifestMergeIdle !== null || downloading.size > 0) return true
      if (prefsBinding?.hasPending()) return true
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
      unwatchPurge?.()
      unwatchPurge = null
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
      await downloadChain
      await prefsBinding?.close()
      prefsBinding = null
    },
  }
}
