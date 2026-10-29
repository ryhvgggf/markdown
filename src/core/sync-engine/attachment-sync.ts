import { decrypt, encrypt } from '@/adapters/crypto/webcrypto-crypto'
import type { AttachmentSyncAdapter } from '@/adapters/sync/attachment-types'

/**
 * Encrypts an attachment's bytes with the vault KEK and uploads it (design doc §3: "附件比照：本機
 * `blobs` 表存明文，上傳前用 KEK 加密成獨立物件存 Supabase Storage"). Call this when a note turns sync
 * on and whenever one of its attachments changes while sync stays on.
 */
export async function pushAttachment(
  attachmentSync: AttachmentSyncAdapter,
  kek: CryptoKey,
  vaultId: string,
  noteId: string,
  attachmentId: string,
  plaintext: Uint8Array,
): Promise<void> {
  await attachmentSync.uploadAttachment(vaultId, noteId, attachmentId, await encrypt(kek, plaintext))
}

/** Downloads and decrypts one attachment. `null` if it was never uploaded (or has since been deleted). */
export async function pullAttachment(
  attachmentSync: AttachmentSyncAdapter,
  kek: CryptoKey,
  vaultId: string,
  attachmentId: string,
): Promise<Uint8Array | null> {
  const ciphertext = await attachmentSync.downloadAttachment(vaultId, attachmentId)
  return ciphertext === null ? null : await decrypt(kek, ciphertext)
}
