import { createTransferServices, type TransferServices } from './transfer-services'
import * as Y from 'yjs'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { DexieStorage } from '@/adapters/storage/dexie-storage'
import { requestPersistence } from '@/adapters/storage/persistence'
import { clearOwnStashes, clearStashed, clearStashedKey, readStashed, stashUpdate } from '@/adapters/storage/unsaved-stash'
import { StorageError, type StorageAdapter } from '@/adapters/storage/types'
import { DIRTY_PREFIX, Indexer } from '@/core/indexer/indexer'
import { Maintenance } from '@/core/maintenance/maintenance'
import { NoteDocCache } from '@/core/note-doc/cache'
import { PERSIST_ORIGIN } from '@/core/persist'
import { Preferences } from '@/core/preferences/preferences'
import { SearchClient } from '@/core/search/search-client'
import { LocalSearch, type SearchService } from '@/core/search/search-service'
import { Vault } from '@/core/vault/vault'

export type StorageErrorEmitter = {
  subscribe(cb: (e: StorageError) => void): () => void
}

export type AppServices = {
  storage: StorageAdapter
  db: NotesDb
  vault: Vault
  notes: NoteDocCache
  indexer: Indexer
  search: SearchService
  prefs: Preferences
  persistence: 'granted' | 'denied' | 'unsupported'
  storageMode: 'persistent' | 'memory'
  storageErrors: StorageErrorEmitter
  /** Best-effort background work: startup clean-up/catch-up (run after the first render) and purges. */
  maintenance: Maintenance
  /** Markdown export / import (and, later, the folder mirror). */
  transfer: TransferServices
  /** Note to open on startup (live note from meta.lastNoteId, else most recent, else null). */
  initialNoteId: string | null
  /** Persists meta.lastNoteId. */
  setLastNoteId(id: string): void
  /** Synchronously stashes every not-yet-stored update (pagehide); recovered on the next start. */
  stashUnsaved(): void
  /** Drops this tab's stash when nothing is pending any more (after a successful flush). */
  clearOwnStash(): void
}

export interface BootstrapOptions {
  dbName?: string
  channelFactory?: (name: string) => BroadcastChannel
  createSearch?: (db: NotesDb, mode: 'persistent' | 'memory') => SearchService
  forceMemory?: boolean
  /** Seed the 「功能導覽」 notes into a brand-new vault (default true; off for the bench and e2e runs). */
  seedGuide?: boolean
}

const VAULT_ID = 'default-vault'
const LAST_NOTE_KEY = 'lastNoteId'
const PREFS_USER = 'local'
export { INDEX_VERSION } from '@/core/maintenance/maintenance'

async function openDb(dbName: string, forceMemory: boolean): Promise<{ db: NotesDb; mode: 'persistent' | 'memory' }> {
  if (!forceMemory) {
    const db = createDb(dbName)
    try {
      await db.open()
      await db.meta.put({ key: 'probe', value: 1 })
      await db.meta.get('probe')
      await db.meta.delete('probe')
      return { db, mode: 'persistent' }
    } catch {
      db.close()
    }
  }
  const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
  const db = createDb(dbName, { indexedDB: new IDBFactory(), IDBKeyRange })
  await db.open()
  return { db, mode: 'memory' }
}

function createEmitter() {
  const listeners = new Set<(e: StorageError) => void>()
  return {
    emit: (e: StorageError) => listeners.forEach((l) => l(e)),
    subscribe(cb: (e: StorageError) => void) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
  }
}

const isMetaDoc = (docId: string) => docId === VAULT_ID || docId.startsWith('prefs:')

/**
 * Writes updates stashed in localStorage by the last pagehide (writes cut off by a reload/close) to
 * IndexedDB. Phase 'meta' (before the vault loads) handles the vault and prefs docs; phase 'notes'
 * (after) writes note stashes only for notes still in the vault (trashed included) and marks them for
 * re-indexing; stashes of permanently deleted notes are dropped so they cannot come back as orphans.
 * Best-effort: an entry that cannot be written stays stashed for the next start.
 */
async function recoverStashed(storage: StorageAdapter, db: NotesDb, phase: 'meta' | 'notes', vault?: Vault): Promise<void> {
  for (const { key, docId, update } of readStashed()) {
    if (isMetaDoc(docId) !== (phase === 'meta')) continue
    try {
      if (update.length > 0 && (phase === 'meta' || vault?.getNote(docId))) {
        await storage.appendUpdate(docId, update)
        if (phase === 'notes') await db.meta.put({ key: DIRTY_PREFIX + docId, value: 1 })
      }
      clearStashedKey(key)
    } catch {
      /* keep it for the next start */
    }
  }
}

/** Serialises first-start work (guide seeding / the welcome note) across tabs; runs `fn` directly without Web Locks. */
async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks
  return locks?.request ? (locks.request('notes-v2-seed', fn) as Promise<T>) : fn()
}

/**
 * The note to open on the first start of an empty vault, decided under the `notes-v2-seed` lock so two tabs
 * opened at once cannot both seed. Inside the lock the vault is caught up from storage (another tab may have
 * written while we waited) and re-checked: if it has notes now, the most recent one opens. Otherwise the
 * built-in guide is added once per device (meta `guideSeeded`, written only after it succeeded, so deleting
 * the guide never brings it back) and its first note opens; else, or on failure, a plain 歡迎使用 note.
 * The guide module is loaded on demand: it pulls in the editor schema, which a normal start does not need.
 */
async function firstStartNote(
  vault: Vault,
  storage: StorageAdapter,
  db: NotesDb,
  seedGuide: boolean,
  report: (e: StorageError) => void,
): Promise<string> {
  return withSeedLock(async () => {
    for (const u of await storage.loadDoc(VAULT_ID)) Y.applyUpdate(vault.doc, u, PERSIST_ORIGIN)
    const live = vault.listNotes()
    // another tab created notes while we waited: open the most recent live one
    if (live.length > 0) return [...live].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    let id: string | null = null
    // the guide only goes into a vault that never had a note (trashed ones count)
    if (seedGuide && vault.listNotes({ includeTrashed: true }).length === 0) {
      try {
        const { addGuide, GUIDE_SEEDED_KEY } = await import('@/features/guide/guide')
        if (!(await db.meta.get(GUIDE_SEEDED_KEY))?.value) {
          id = (await addGuide({ vault, storage, db })).noteIds[0] ?? null
          await db.meta.put({ key: GUIDE_SEEDED_KEY, value: Date.now() })
        }
      } catch (e) {
        report(e instanceof StorageError ? e : new StorageError('unknown', String(e), { cause: e }))
      }
    }
    // never a trashed note; a guide that failed half-way may already hold 歡迎使用
    id ??= vault.isTitleAvailable('歡迎使用') ? vault.createNote({ title: '歡迎使用' }).id : vault.listNotes()[0].id
    await vault.flushWrites() // stored before the lock is released: the next tab must see this note
    return id
  })
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const dbName = opts.dbName ?? 'notes-v2'
  const { db, mode } = await openDb(dbName, opts.forceMemory ?? false)
  const storage = new DexieStorage(db)
  const errors = createEmitter()
  const common = { channelFactory: opts.channelFactory, onStorageError: errors.emit }

  const persistence = mode === 'memory' ? 'unsupported' : await requestPersistence()
  if (mode === 'persistent') await recoverStashed(storage, db, 'meta')
  const vault = await Vault.open(storage, VAULT_ID, common)
  if (mode === 'persistent') await recoverStashed(storage, db, 'notes', vault)
  const notes = new NoteDocCache(storage, { ...common, clearStash: clearStashed })
  const prefs = await Preferences.open(storage, PREFS_USER, common)
  const indexer = new Indexer(db, vault, notes, storage, { onError: errors.emit })
  const createSearch =
    opts.createSearch ?? ((d, m) => (m === 'persistent' ? new SearchClient({ dbName }) : new LocalSearch(d)))
  const search = createSearch(db, mode)
  const maintenance = new Maintenance({ db, storage, vault, notes, indexer, onError: errors.emit })
  // Purges, index rebuild/catch-up and attachment GC are NOT run here: they are off the critical path
  // (App starts `maintenance.runStartup()` after the first render) and can never block opening the app.
  indexer.start()
  const transfer = createTransferServices({ vault, storage, db, notes, indexer })
  // A permanent delete interrupted last time: its vault entries go before the UI shows (O(pending), guarded
  // against restored/open notes); doc and index deletion continues in the background.
  try {
    await maintenance.finishPendingPurges({ deferData: true })
  } catch (e) {
    errors.emit(e instanceof StorageError ? e : new StorageError('unknown', String(e), { cause: e }))
  }

  // Pick the note to open; create the welcome note on first run.
  const setLastNoteId = (id: string) => {
    void db.meta.put({ key: LAST_NOTE_KEY, value: id }).catch((e) => errors.emit(e as StorageError))
  }
  let initialNoteId: string | null
  if (vault.listNotes({ includeTrashed: true }).length === 0) {
    initialNoteId = await firstStartNote(vault, storage, db, opts.seedGuide ?? true, errors.emit)
    await db.meta.put({ key: LAST_NOTE_KEY, value: initialNoteId })
  } else {
    const saved = (await db.meta.get(LAST_NOTE_KEY))?.value
    const live = vault.listNotes()
    if (typeof saved === 'string' && live.some((n) => n.id === saved)) initialNoteId = saved
    else initialNoteId = [...live].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
  }

  return {
    storage, db, vault, notes, indexer, search, prefs, persistence,
    storageMode: mode, storageErrors: { subscribe: errors.subscribe }, maintenance, transfer, initialNoteId, setLastNoteId,
    stashUnsaved() {
      if (mode !== 'persistent') return
      vault.stashUnsaved(stashUpdate)
      notes.stashUnsaved(stashUpdate)
      prefs.stashUnsaved(stashUpdate)
    },
    clearOwnStash() {
      if (notes.hasUnsaved() || vault.hasPendingWrites() || prefs.hasPendingWrites()) return
      clearOwnStashes()
    },
  }
}
