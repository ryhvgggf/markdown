import type { AttachmentSyncAdapter } from './attachment-types'

/** In-memory fake `AttachmentSyncAdapter` for tests, matching `memory-sync.ts`'s pattern. */
export class MemoryAttachmentSync implements AttachmentSyncAdapter {
  /** `${vaultId}:${attachmentId}` → ciphertext (the Storage bucket). */
  private blobs = new Map<string, Uint8Array>()
  /** `${vaultId}:${attachmentId}` → ids of notes using it (the `attachment_refs` table). */
  private refs = new Map<string, Set<string>>()

  private key(vaultId: string, attachmentId: string) {
    return `${vaultId}:${attachmentId}`
  }

  async uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void> {
    const k = this.key(vaultId, attachmentId)
    this.blobs.set(k, ciphertext)
    const notes = this.refs.get(k) ?? new Set<string>()
    notes.add(noteId)
    this.refs.set(k, notes)
  }

  async downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null> {
    return this.blobs.get(this.key(vaultId, attachmentId)) ?? null
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    const k = this.key(vaultId, attachmentId)
    this.blobs.delete(k)
    this.refs.delete(k)
  }

  async deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void> {
    for (const id of await this.listAttachments(vaultId, noteId)) {
      const k = this.key(vaultId, id)
      const notes = this.refs.get(k)!
      notes.delete(noteId)
      if (notes.size === 0) {
        this.refs.delete(k)
        this.blobs.delete(k)
      }
    }
  }

  async listAttachments(vaultId: string, noteId: string): Promise<string[]> {
    const prefix = `${vaultId}:`
    return [...this.refs.entries()].filter(([k, notes]) => k.startsWith(prefix) && notes.has(noteId)).map(([k]) => k.slice(prefix.length))
  }
}
