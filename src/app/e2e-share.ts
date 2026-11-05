import { fromB64, toB64 } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryShare, type MemoryShareRow } from '@/adapters/share/memory-share'
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

type Row = Omit<MemoryShareRow, 'ciphertext' | 'verifier'> & { ciphertext: string; verifier: string | null }

const load = (): Map<string, MemoryShareRow> => {
  try {
    const rows = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Row>
    return new Map(
      Object.values(rows).map((r) => [r.id, { ...r, ciphertext: fromB64(r.ciphertext), verifier: r.verifier === null ? null : fromB64(r.verifier) }]),
    )
  } catch {
    return new Map()
  }
}
const save = (rows: Map<string, MemoryShareRow>) =>
  localStorage.setItem(
    STORE,
    JSON.stringify(Object.fromEntries([...rows].map(([id, r]) => [id, { ...r, ciphertext: toB64(r.ciphertext), verifier: r.verifier && toB64(r.verifier) }]))),
  )

/** The in-memory adapter, with its rows kept in localStorage so a second page sees them. */
export class LocalStorageShare extends MemoryShare {
  constructor() {
    super(Date.now, { load, save })
    this.userId = 'e2e-user'
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
