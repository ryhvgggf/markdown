/**
 * `adapters/sync`'s attachment half (design doc §3, §4): moves encrypted attachment bytes to/from
 * Supabase Storage, plus `attachment_refs` rows recording which synced notes use each one. Like
 * `SyncAdapter`, everything here is opaque ciphertext — this adapter never sees plaintext and never
 * derives or holds a key.
 *
 * One attachment can be used by several notes (same as locally, where `attachmentRefs` is many-to-many),
 * so ownership is a set of (attachment, note) refs, not a single owner: the blob stays in the cloud as long
 * as any synced note still refers to it.
 */
export interface AttachmentSyncAdapter {
  /** Uploads one attachment's ciphertext (overwrites on retry) and records that `noteId` uses it. */
  uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void>
  /**
   * `null` only if this attachment isn't in the cloud (never uploaded, or deleted). Any other failure
   * (offline, expired session, permission) throws `SyncError` — callers must not mistake those for "gone".
   */
  downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null>
  /** Removes the attachment entirely: its blob and every note's ref to it. */
  deleteAttachment(vaultId: string, attachmentId: string): Promise<void>
  /**
   * Turning sync off for a note (design doc §4): drops the note's refs, and deletes the blob of each
   * attachment no other synced note still uses. Attachments shared with another synced note stay.
   */
  deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void>
  listAttachments(vaultId: string, noteId: string): Promise<string[]>
}
