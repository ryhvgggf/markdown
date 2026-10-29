/**
 * Live round-trip check against a real Supabase project (phase 3 design doc §4, §8) — not part of the
 * regular test suite (needs a real project + network), run manually when you have one set up:
 *
 *   npm run sync:smoke-test   (runs via tsx — the script imports local .ts modules without extensions,
 *   which Node's own native type-stripping doesn't resolve; unlike scripts/bench.ts, which only imports
 *   packages and can run with plain `node`)
 *
 * Needs .env.local (see .env.example) with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, the migration in
 * supabase/migrations/0001 and 0002 already run, and "Confirm email" OFF under Authentication →
 * Sign In / Providers → Email in the Supabase dashboard (otherwise sign-up won't return a usable session —
 * turn it back on afterwards for real use).
 *
 * Exercises: sign-in-or-sign-up (fixed throwaway account, reused across runs — see signInOrSignUp below) →
 * vault_keys round trip → unlock with password → push 2 updates + a snapshot for a note → pull and verify
 * byte-for-byte → turn sync off for the note (delete) → confirm it's gone → push/pull the cloud structure
 * manifest (design doc §3.1) and confirm it's filtered and encrypted → upload/download an attachment
 * (design doc §3; bucket + policies come from supabase/migrations/0002) and confirm it's
 * encrypted too.
 *
 * Uses one fixed account across runs instead of a fresh sign-up each time: Supabase's built-in email
 * service has a low, fixed hourly send rate limit that sign-up counts against even with email
 * confirmation off, and re-running this script a few times in a row exhausts it. Sign-in sends no email,
 * so only the very first run (or one after the account is deleted) pays that cost.
 */
import { createClient } from '@supabase/supabase-js'
import { signIn, signUp, unlockVaultWithPassword } from '../src/core/account/account'
import { SupabaseAuth } from '../src/adapters/auth/supabase-auth'
import { AuthError } from '../src/adapters/auth/types'
import { SupabaseKeyStore } from '../src/adapters/key-store/supabase-key-store'
import { SupabaseSync } from '../src/adapters/sync/supabase-sync'
import { SupabaseAttachmentSync } from '../src/adapters/sync/supabase-attachment-sync'
import { decrypt, encrypt } from '../src/adapters/crypto/webcrypto-crypto'
import { pullManifest, pushManifest } from '../src/core/sync-engine/manifest-sync'
import { pullAttachment, pushAttachment } from '../src/core/sync-engine/attachment-sync'
import { decryptDocChunk, encryptDocChunk } from '../src/core/sync-engine/doc-crypto'
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
const attachmentSync = new SupabaseAttachmentSync(client)

const ok = (label: string, pass: boolean) => {
  console.log(`${pass ? '✓' : '✗'} ${label}`)
  if (!pass) process.exitCode = 1
}
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

const FIXED_EMAIL = 'smoke-test-fixed@yopmail.com'
const FIXED_PASSWORD = 'smoke-test-password-123'

/** Signs in to the one reused throwaway account; signs it up only the first time it doesn't exist yet. */
async function signInOrSignUp(email: string, password: string): Promise<{ vaultId: string; kek: CryptoKey; isNew: boolean }> {
  try {
    const si = await signIn({ auth, keyStore }, email, password)
    const vaultId = si.vaults[0]?.vaultId
    if (!vaultId) throw new Error(`signed in to ${email} but it has no vault — delete it from Authentication → Users and rerun`)
    const kek = await unlockVaultWithPassword(keyStore, vaultId, password)
    return { vaultId, kek, isNew: false }
  } catch (e) {
    if (e instanceof AuthError && e.kind === 'invalid-credentials') {
      const su = await signUp({ auth, keyStore }, email, password)
      return { vaultId: su.vaultId, kek: su.kek, isNew: true }
    }
    throw e
  }
}

async function main() {
  const { vaultId, kek, isNew } = await signInOrSignUp(FIXED_EMAIL, FIXED_PASSWORD)
  ok(isNew ? 'signed up the fixed test account (first run)' : 'signed in to the existing fixed test account', !!vaultId)

  const probe = enc('round-trip probe')
  ok('unlockVaultWithPassword recovers a working KEK', dec(await decrypt(kek, await encrypt(kek, probe))) === dec(probe))

  const noteId = 'smoke-note-1'
  const deviceId = 'smoke-device-1'
  const seal = (docId: string, s: string) => encryptDocChunk(kek, vaultId, docId, enc(s))
  const open = (docId: string, c: Uint8Array) => decryptDocChunk(kek, vaultId, docId, c)
  const seq1 = await sync.pushUpdate(vaultId, noteId, await seal(noteId, 'update 1'), deviceId)
  const seq2 = await sync.pushUpdate(vaultId, noteId, await seal(noteId, 'update 2'), deviceId)
  ok('pushUpdate assigns increasing seq', seq2 > seq1)

  const pulled = await sync.pullDoc(vaultId, noteId)
  const decrypted = await Promise.all(pulled.map((c) => open(noteId, c)))
  ok(
    'pullDoc returns both pushed updates, decryptable, in order',
    decrypted.length === 2 && dec(decrypted[0]) === 'update 1' && dec(decrypted[1]) === 'update 2',
  )

  await sync.pushSnapshot(vaultId, noteId, await seal(noteId, 'compacted snapshot'), seq2)
  const afterSnapshot = await sync.pullDoc(vaultId, noteId)
  ok(
    'pushSnapshot replaces prior updates (pullDoc now returns just the snapshot)',
    afterSnapshot.length === 1 && dec(await open(noteId, afterSnapshot[0])) === 'compacted snapshot',
  )
  let swapRejected = false
  try {
    await open('some-other-note', afterSnapshot[0])
  } catch {
    swapRejected = true
  }
  ok("a note's ciphertext won't decrypt as another note (AAD binding)", swapRejected)

  await sync.deleteDoc(vaultId, noteId)
  const afterDelete = await sync.pullDoc(vaultId, noteId)
  ok('deleteDoc (turning sync off for a note) leaves nothing behind', afterDelete.length === 0)

  const otherNoteId = 'smoke-note-2'
  await sync.pushUpdate(vaultId, otherNoteId, await seal(otherNoteId, 'x'), deviceId)
  const docs = await sync.listDocs(vaultId)
  ok('listDocs reflects deletion and remaining docs', !docs.includes(noteId) && docs.includes(otherNoteId))
  await sync.deleteDoc(vaultId, otherNoteId) // cleanup: this account is reused across runs

  const folders: FolderMeta[] = [{ id: 'f1', name: 'Folder', parentId: null, order: 'a', createdAt: 0, deletedAt: null }]
  const notes: NoteMeta[] = [
    { id: 'synced-note', title: 'secret title', folderId: 'f1', order: 'a', createdAt: 0, updatedAt: 0, deletedAt: null, synced: true },
    { id: 'unsynced-note', title: 'should never leave the device', folderId: 'f1', order: 'b', createdAt: 0, updatedAt: 0, deletedAt: null, synced: false },
  ]
  await pushManifest(sync, kek, vaultId, notes, folders)
  const manifest = await pullManifest(sync, kek, vaultId)
  ok(
    'pullManifest returns only the synced note and the folder it needs',
    manifest !== null && manifest.notes.map((n) => n.id).join(',') === 'synced-note' && manifest.folders.map((f) => f.id).join(',') === 'f1',
  )
  const [rawManifest] = await sync.pullDoc(vaultId, `${vaultId}-manifest`)
  ok(
    'the cloud manifest row is opaque ciphertext — no plaintext note title leaked',
    !new TextDecoder().decode(rawManifest).includes('secret title') && rawManifest.length > 0,
  )

  const attachmentId = 'smoke-attachment-1'
  const attachmentBytes = enc('fake image bytes for the smoke test')
  await pushAttachment(attachmentSync, kek, vaultId, 'synced-note', attachmentId, attachmentBytes)
  const pulledAttachment = await pullAttachment(attachmentSync, kek, vaultId, attachmentId)
  ok(
    'pushAttachment/pullAttachment round-trip the bytes',
    pulledAttachment !== null && dec(pulledAttachment) === dec(attachmentBytes),
  )
  const rawAttachment = await attachmentSync.downloadAttachment(vaultId, attachmentId)
  ok(
    "what's actually in Storage is opaque ciphertext, not the plaintext",
    rawAttachment !== null && !new TextDecoder().decode(rawAttachment).includes('fake image bytes'),
  )
  // the same attachment used by a second synced note must survive turning sync off for the first
  await pushAttachment(attachmentSync, kek, vaultId, 'second-note', attachmentId, attachmentBytes)
  await attachmentSync.deleteAttachmentsForNote(vaultId, 'synced-note')
  ok(
    'deleteAttachmentsForNote keeps an attachment another synced note still uses',
    (await attachmentSync.downloadAttachment(vaultId, attachmentId)) !== null &&
      (await attachmentSync.listAttachments(vaultId, 'synced-note')).length === 0,
  )
  await attachmentSync.deleteAttachmentsForNote(vaultId, 'second-note')
  ok(
    'deleteAttachmentsForNote removes it once no synced note uses it (missing object → null, not an error)',
    (await attachmentSync.downloadAttachment(vaultId, attachmentId)) === null,
  )

  console.log(`\nTest account: ${FIXED_EMAIL} (reused on every run — leave it, no need to delete)`)
}

main().catch((e) => {
  console.error('Smoke test crashed:', e)
  process.exitCode = 1
})
