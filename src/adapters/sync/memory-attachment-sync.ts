import type { AttachmentSyncAdapter } from './attachment-types'

/** In-memory fake `AttachmentSyncAdapter` for tests, matching `memory-sync.ts`'s pattern. */
export class MemoryAttachmentSync implements AttachmentSyncAdapter {
  private rows = new Map<string, { noteId: string; ciphertext: Uint8Array }>()

  private key(vaultId: string, attachmentId: string) {
    return `${vaultId}:${attachmentId}`
  }

  async uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void> {
    this.rows.set(this.key(vaultId, attachmentId), { noteId, ciphertext })
  }

  async downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null> {
    return this.rows.get(this.key(vaultId, attachmentId))?.ciphertext ?? null
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    this.rows.delete(this.key(vaultId, attachmentId))
  }

  async deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void> {
    for (const [k, row] of this.rows) {
      if (row.noteId === noteId && k.startsWith(`${vaultId}:`)) this.rows.delete(k)
    }
  }

  async listAttachments(vaultId: string, noteId: string): Promise<string[]> {
    const prefix = `${vaultId}:`
    return [...this.rows.entries()]
      .filter(([k, row]) => k.startsWith(prefix) && row.noteId === noteId)
      .map(([k]) => k.slice(prefix.length))
  }
}
