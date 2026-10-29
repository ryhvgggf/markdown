/**
 * Live round-trip check against a real Supabase project (phase 3 design doc §4, §8) — not part of the
 * regular test suite (needs a real project + network), run manually when you have one set up:
 *
 *   npm run sync:smoke-test   (runs via tsx — the script imports local .ts modules without extensions,
 *   which Node's own native type-stripping doesn't resolve; unlike scripts/bench.ts, which only imports
 *   packages and can run with plain `node`)
 *
 * Needs .env.local (see .env.example) with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, the migration in
 * supabase/migrations/0001_phase3_schema.sql already run, and "Confirm email" OFF under Authentication →
 * Sign In / Providers → Email in the Supabase dashboard (otherwise sign-up won't return a usable session —
 * turn it back on afterwards for real use).
 *
 * Exercises: sign-up → vault_keys round trip → unlock with password → push 2 updates + a snapshot for a
 * note → pull and verify byte-for-byte → turn sync off for the note (delete) → confirm it's gone →
 * push/pull the cloud structure manifest (design doc §3.1) and confirm it's filtered and encrypted.
 */
import { createClient } from '@supabase/supabase-js'
import { signUp, unlockVaultWithPassword } from '../src/core/account/account'
import { SupabaseAuth } from '../src/adapters/auth/supabase-auth'
import { SupabaseKeyStore } from '../src/adapters/key-store/supabase-key-store'
import { SupabaseSync } from '../src/adapters/sync/supabase-sync'
import { decrypt, encrypt } from '../src/adapters/crypto/webcrypto-crypto'
import { pullManifest, pushManifest } from '../src/core/sync-engine/manifest-sync'
import type { FolderMeta, NoteMeta } from '../src/core/vault/types'

try {
  process.loadEnvFile('.env.local') // Node >= 20.6; no dotenv dependency needed
} catch {
  /* no .env.local — fall through, the missing-vars check below reports it */
}

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill it in.')
  process.exit(1)
}

const client = createClient(url, anonKey)
const auth = new SupabaseAuth(client)
const keyStore = new SupabaseKeyStore(client)
const sync = new SupabaseSync(client)

const ok = (label: string, pass: boolean) => {
  console.log(`${pass ? '✓' : '✗'} ${label}`)
  if (!pass) process.exitCode = 1
}
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

async function main() {
  const email = `smoke-test-${Date.now()}@yopmail.com`
  const password = 'smoke-test-password-123'

  const su = await signUp({ auth, keyStore }, email, password)
  ok('signUp returns a vaultId + recovery code', !!su.vaultId && !!su.recoveryCode)

  const kek = await unlockVaultWithPassword(keyStore, su.vaultId, password)
  const probe = enc('round-trip probe')
  ok('unlockVaultWithPassword recovers a working KEK', dec(await decrypt(kek, await encrypt(kek, probe))) === dec(probe))

  const noteId = 'smoke-note-1'
  const deviceId = 'smoke-device-1'
  const seq1 = await sync.pushUpdate(su.vaultId, noteId, await encrypt(su.kek, enc('update 1')), deviceId)
  const seq2 = await sync.pushUpdate(su.vaultId, noteId, await encrypt(su.kek, enc('update 2')), deviceId)
  ok('pushUpdate assigns increasing seq', seq2 > seq1)

  const pulled = await sync.pullDoc(su.vaultId, noteId)
  const decrypted = await Promise.all(pulled.map((c) => decrypt(su.kek, c)))
  ok(
    'pullDoc returns both pushed updates, decryptable, in order',
    decrypted.length === 2 && dec(decrypted[0]) === 'update 1' && dec(decrypted[1]) === 'update 2',
  )

  await sync.pushSnapshot(su.vaultId, noteId, await encrypt(su.kek, enc('compacted snapshot')), seq2)
  const afterSnapshot = await sync.pullDoc(su.vaultId, noteId)
  ok(
    'pushSnapshot replaces prior updates (pullDoc now returns just the snapshot)',
    afterSnapshot.length === 1 && dec(await decrypt(su.kek, afterSnapshot[0])) === 'compacted snapshot',
  )

  await sync.deleteDoc(su.vaultId, noteId)
  const afterDelete = await sync.pullDoc(su.vaultId, noteId)
  ok('deleteDoc (turning sync off for a note) leaves nothing behind', afterDelete.length === 0)

  const otherNoteId = 'smoke-note-2'
  await sync.pushUpdate(su.vaultId, otherNoteId, await encrypt(su.kek, enc('x')), deviceId)
  const docs = await sync.listDocs(su.vaultId)
  ok('listDocs reflects deletion and remaining docs', !docs.includes(noteId) && docs.includes(otherNoteId))

  const folders: FolderMeta[] = [{ id: 'f1', name: 'Folder', parentId: null, order: 'a', createdAt: 0, deletedAt: null }]
  const notes: NoteMeta[] = [
    { id: 'synced-note', title: 'secret title', folderId: 'f1', order: 'a', createdAt: 0, updatedAt: 0, deletedAt: null, synced: true },
    { id: 'unsynced-note', title: 'should never leave the device', folderId: 'f1', order: 'b', createdAt: 0, updatedAt: 0, deletedAt: null, synced: false },
  ]
  await pushManifest(sync, su.kek, su.vaultId, notes, folders)
  const manifest = await pullManifest(sync, su.kek, su.vaultId)
  ok(
    'pullManifest returns only the synced note and the folder it needs',
    manifest !== null && manifest.notes.map((n) => n.id).join(',') === 'synced-note' && manifest.folders.map((f) => f.id).join(',') === 'f1',
  )
  const [rawManifest] = await sync.pullDoc(su.vaultId, `${su.vaultId}-manifest`)
  const rawText = Array.from(rawManifest).join(',')
  ok(
    'the cloud manifest row is opaque ciphertext — no plaintext note title leaked',
    !new TextDecoder().decode(rawManifest).includes('secret title') && rawText.length > 0,
  )

  console.log('\nTest account:', email, '(safe to delete from Authentication → Users in the dashboard)')
}

main().catch((e) => {
  console.error('Smoke test crashed:', e)
  process.exitCode = 1
})
