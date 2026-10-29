/**
 * `adapters/sync`'s attachment half (design doc §3, §4): moves encrypted attachment bytes to/from
 * Supabase Storage, plus the `attachments` table row that records which note owns each one. Like
 * `SyncAdapter`, everything here is opaque ciphertext — this adapter never sees plaintext and never
 * derives or holds a key.
 */
export interface AttachmentSyncAdapter {
  /** Uploads one attachment's ciphertext and records its (vaultId, noteId) ownership. Overwrites on retry. */
  uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void>
  /** `null` if this attachment was never uploaded (or was already deleted). */
  downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null>
  deleteAttachment(vaultId: string, attachmentId: string): Promise<void>
  /** Design doc §4: `noteId` on `attachments` lets turning sync off for a note cascade-delete its attachments. */
  deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void>
  listAttachments(vaultId: string, noteId: string): Promise<string[]>
}
