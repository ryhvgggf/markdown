import { createDb, type NotesDb } from '@/adapters/storage/db'
import { DexieStorage } from '@/adapters/storage/dexie-storage'
import { requestPersistence } from '@/adapters/storage/persistence'
import { clearStashed, readStashed, stashUpdate } from '@/adapters/storage/unsaved-stash'
import type { StorageAdapter, StorageError } from '@/adapters/storage/types'
import { DIRTY_PREFIX, Indexer } from '@/core/indexer/indexer'
import { Maintenance } from '@/core/maintenance/maintenance'
import { NoteDocCache } from '@/core/note-doc/cache'
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
  /** Note to open on startup (live note from meta.lastNoteId, else most recent, else null). */
  initialNoteId: string | null
  /** Persists meta.lastNoteId. */
  setLastNoteId(id: string): void
  /** Synchronously stashes every not-yet-stored update (pagehide); recovered on the next start. */
  stashUnsaved(): void
}

export interface BootstrapOptions {
  dbName?: string
  channelFactory?: (name: string) => BroadcastChannel
  createSearch?: (db: NotesDb, mode: 'persistent' | 'memory') => SearchService
  forceMemory?: boolean
}

const VAULT_ID = 'default-vault'
const LAST_NOTE_KEY = 'lastNoteId'
const PREFS_ID = 'local'
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

/**
 * Writes updates stashed in localStorage by the last pagehide (writes cut off by a reload/close) to
 * IndexedDB before anything is loaded, and marks those notes for re-indexing. Best-effort: an entry that
 * cannot be written stays stashed for the next start.
 */
async function recoverStashed(storage: StorageAdapter, db: NotesDb): Promise<void> {
  for (const { docId, update } of readStashed()) {
    try {
      if (update.length > 0) {
        await storage.appendUpdate(docId, update)
        if (docId !== VAULT_ID && docId !== PREFS_ID) await db.meta.put({ key: DIRTY_PREFIX + docId, value: 1 })
      }
      clearStashed(docId)
    } catch {
      /* keep it for the next start */
    }
  }
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const dbName = opts.dbName ?? 'notes-v2'
  const { db, mode } = await openDb(dbName, opts.forceMemory ?? false)
  const storage = new DexieStorage(db)
  const errors = createEmitter()
  const common = { channelFactory: opts.channelFactory, onStorageError: errors.emit }

  const persistence = mode === 'memory' ? 'unsupported' : await requestPersistence()
  if (mode === 'persistent') await recoverStashed(storage, db)
  const vault = await Vault.open(storage, VAULT_ID, common)
  const notes = new NoteDocCache(storage, common)
  const prefs = await Preferences.open(storage, PREFS_ID, common)
  const indexer = new Indexer(db, vault, notes, storage, { onError: errors.emit })
  const createSearch =
    opts.createSearch ?? ((d, m) => (m === 'persistent' ? new SearchClient({ dbName }) : new LocalSearch(d)))
  const search = createSearch(db, mode)
  const maintenance = new Maintenance({ db, storage, vault, notes, indexer, onError: errors.emit })
  // Purges, index rebuild/catch-up and attachment GC are NOT run here: they are off the critical path
  // (App starts `maintenance.runStartup()` after the first render) and can never block opening the app.
  indexer.start()

  // Pick the note to open; create the welcome note on first run.
  const setLastNoteId = (id: string) => {
    void db.meta.put({ key: LAST_NOTE_KEY, value: id }).catch((e) => errors.emit(e as StorageError))
  }
  let initialNoteId: string | null
  if (vault.listNotes({ includeTrashed: true }).length === 0) {
    initialNoteId = vault.createNote({ title: '歡迎使用' }).id
    await db.meta.put({ key: LAST_NOTE_KEY, value: initialNoteId })
  } else {
    const saved = (await db.meta.get(LAST_NOTE_KEY))?.value
    const live = vault.listNotes()
    if (typeof saved === 'string' && live.some((n) => n.id === saved)) initialNoteId = saved
    else initialNoteId = [...live].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
  }

  return {
    storage, db, vault, notes, indexer, search, prefs, persistence,
    storageMode: mode, storageErrors: { subscribe: errors.subscribe }, maintenance, initialNoteId, setLastNoteId,
    stashUnsaved() {
      if (mode !== 'persistent') return
      vault.stashUnsaved(stashUpdate)
      notes.stashUnsaved(stashUpdate)
    },
  }
}
