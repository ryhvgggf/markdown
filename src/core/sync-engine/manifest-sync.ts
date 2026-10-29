import { decrypt, encrypt } from '@/adapters/crypto/webcrypto-crypto'
import type { SyncAdapter } from '@/adapters/sync/types'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import { decodeManifest, encodeManifest } from './manifest-codec'
import { deriveManifest, type StructureManifest } from './manifest'

/** The manifest's fixed `docId` within a vault (design doc §3.1: `vaultId + '-manifest'`). */
export const manifestDocId = (vaultId: string) => `${vaultId}-manifest`

/**
 * Recomputes the cloud structure manifest from the current local notes/folders and overwrites the
 * cloud copy wholesale (design doc §3.1, §7: "維護雲端結構清單...隨 synced 筆記增減即時重算並上傳").
 * Call this after `Vault.setNoteSynced` and after any structure change (rename/move/trash) that could
 * affect a synced note's title or folder chain. Always a snapshot, never an incremental update — the
 * manifest has no meaningful diff to send, only a new filtered view of the current state.
 */
export async function pushManifest(
  sync: SyncAdapter,
  kek: CryptoKey,
  vaultId: string,
  notes: readonly NoteMeta[],
  folders: readonly FolderMeta[],
): Promise<void> {
  const ciphertext = await encrypt(kek, encodeManifest(deriveManifest(notes, folders)))
  await sync.pushSnapshot(vaultId, manifestDocId(vaultId), ciphertext, 0)
}

/**
 * Downloads and decrypts the cloud structure manifest (design doc §8 "新裝置登入"). Returns `null` when
 * no note has ever been synced for this vault, so there is nothing to show yet.
 */
export async function pullManifest(sync: SyncAdapter, kek: CryptoKey, vaultId: string): Promise<StructureManifest | null> {
  const chunks = await sync.pullDoc(vaultId, manifestDocId(vaultId))
  if (chunks.length === 0) return null
  // pushManifest only ever writes a single snapshot and never an update for this docId, so there is at
  // most one chunk; decrypting the rest would be meaningless even if a future bug produced more.
  return decodeManifest(await decrypt(kek, chunks[0]))
}
