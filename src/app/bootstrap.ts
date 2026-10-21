import { createDb, type NotesDb } from '@/adapters/storage/db'
import { DexieStorage } from '@/adapters/storage/dexie-storage'
import { requestPersistence } from '@/adapters/storage/persistence'
import type { StorageAdapter, StorageError } from '@/adapters/storage/types'
import { Indexer } from '@/core/indexer/indexer'
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
  /** Note to open on startup (live note from meta.lastNoteId, else most recent, else null). */
  initialNoteId: string | null
  /** Persists meta.lastNoteId. */
  setLastNoteId(id: string): void
}

export interface BootstrapOptions {
  dbName?: string
  channelFactory?: (name: string) => BroadcastChannel
  createSearch?: (db: NotesDb, mode: 'persistent' | 'memory') => SearchService
  forceMemory?: boolean
}

const VAULT_ID = 'default-vault'
const LAST_NOTE_KEY = 'lastNoteId'

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

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const dbName = opts.dbName ?? 'notes-v2'
  const { db, mode } = await openDb(dbName, opts.forceMemory ?? false)
  const storage = new DexieStorage(db)
  const errors = createEmitter()
  const common = { channelFactory: opts.channelFactory, onStorageError: errors.emit }

  const persistence = mode === 'memory' ? 'unsupported' : await requestPersistence()
  const vault = await Vault.open(storage, VAULT_ID, common)
  const notes = new NoteDocCache(storage, common)
  const prefs = await Preferences.open(storage, 'local', common)
  const indexer = new Indexer(db, vault, notes, storage)
  const createSearch =
    opts.createSearch ?? ((d, m) => (m === 'persistent' ? new SearchClient({ dbName }) : new LocalSearch(d)))
  const search = createSearch(db, mode)

  // Startup maintenance: purge expired trash.
  const purged = vault.purgeExpired(Date.now(), await indexer.referencedAttachmentIds())
  for (const id of purged.noteIds) {
    await notes.remove(id)
    await indexer.removeNote(id)
  }
  for (const id of purged.attachmentIds) await storage.deleteBlob(id)
  if (vault.listNotes().length > 0 && (await db.noteText.count()) === 0) await indexer.rebuildAll()
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
    storageMode: mode, storageErrors: { subscribe: errors.subscribe }, initialNoteId, setLastNoteId,
  }
}
