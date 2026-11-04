import { fromB64, toB64 } from '@/adapters/crypto/webcrypto-crypto'
import { ShareError, type NewShare, type ShareAdapter, type ShareRecord } from '@/adapters/share/types'
import type { ShareFacade } from './share-facade'
import { SYNC_VAULT_KEY } from './account-service'
import { createShareFacade } from './share-facade'
import type { NotesDb } from '@/adapters/storage/db'

/**
 * Automated runs only (navigator.webdriver plus the localStorage flag, see `main.tsx`): share links are kept in
 * localStorage instead of Supabase, so a spec can create a link in the app and open it in a second page without
 * a server. Never reachable in a normal browser.
 */
export const E2E_SHARE_FLAG = 'notes-v2:e2e-share'
const STORE = 'notes-v2:e2e-share-rows'

type Row = Omit<ShareRecord, never> & { userId: string; ciphertext: string }

const read = (): Record<string, Row> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Row>
  } catch {
    return {}
  }
}
const write = (rows: Record<string, Row>) => localStorage.setItem(STORE, JSON.stringify(rows))

export class LocalStorageShare implements ShareAdapter {
  async create(s: NewShare): Promise<void> {
    const rows = read()
    const t = Date.now()
    rows[s.id] = { id: s.id, vaultId: s.vaultId, noteId: s.noteId, wrappedKey: s.wrappedKey, userId: s.userId, ciphertext: toB64(s.ciphertext), createdAt: t, updatedAt: t }
    write(rows)
  }
  async update(id: string, ciphertext: Uint8Array): Promise<void> {
    const rows = read()
    if (!rows[id]) throw new ShareError('not-found')
    rows[id] = { ...rows[id], ciphertext: toB64(ciphertext), updatedAt: Date.now() }
    write(rows)
  }
  async remove(id: string): Promise<void> {
    const rows = read()
    delete rows[id]
    write(rows)
  }
  async removeForNotes(vaultId: string, noteIds: string[]): Promise<void> {
    const rows = read()
    const ids = new Set(noteIds)
    for (const [id, r] of Object.entries(rows)) if (r.vaultId === vaultId && ids.has(r.noteId)) delete rows[id]
    write(rows)
  }
  async listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]> {
    return Object.values(read())
      .filter((r) => r.vaultId === vaultId && r.noteId === noteId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, vaultId, noteId, wrappedKey, createdAt, updatedAt }) => ({ id, vaultId, noteId, wrappedKey, createdAt, updatedAt }))
  }
  async getPublic(id: string): Promise<Uint8Array | null> {
    const r = read()[id]
    return r ? fromB64(r.ciphertext) : null
  }
}

export function isE2eShare(): boolean {
  try {
    return !!navigator.webdriver && localStorage.getItem(E2E_SHARE_FLAG) === '1'
  } catch {
    return false
  }
}

/** A signed-in fake account (random key per page load) over the localStorage links. */
export function createE2eShareFacade(db: NotesDb): ShareFacade {
  let kek: Promise<CryptoKey> | undefined
  void db.meta.put({ key: SYNC_VAULT_KEY, value: 'e2e-vault' }) // this fake device counts as signed in once
  return createShareFacade({
    db,
    origin: location.origin,
    adapter: async () => new LocalStorageShare(),
    account: async () => ({
      userId: 'e2e-user',
      vaultId: 'e2e-vault',
      kek: await (kek ??= crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])),
    }),
  })
}
