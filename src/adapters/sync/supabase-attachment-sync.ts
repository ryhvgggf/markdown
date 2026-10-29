import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentSyncAdapter } from './attachment-types'
import { SyncError } from './types'

/** Storage bucket holding encrypted attachment blobs (private; created once per project, see README note). */
const BUCKET = 'attachments'

const storagePath = (vaultId: string, attachmentId: string) => `${vaultId}/${attachmentId}`

/**
 * Real `AttachmentSyncAdapter`: the ciphertext bytes live in Supabase Storage (the `attachments` table
 * only tracks ownership — `vaultId`/`noteId`/`size` — so `deleteAttachmentsForNote` can cascade without
 * listing the bucket). Not yet verified against a live project: the `attachments` Storage bucket (private,
 * name "attachments") still needs to be created in the dashboard before this can be smoke-tested, the way
 * "Confirm email" had to be toggled for 3c part 1's Auth testing.
 */
export class SupabaseAttachmentSync implements AttachmentSyncAdapter {
  constructor(private client: SupabaseClient) {}

  async uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void> {
    const path = storagePath(vaultId, attachmentId)
    const { error: uploadError } = await this.client.storage.from(BUCKET).upload(path, ciphertext, { upsert: true })
    if (uploadError) throw new SyncError('unknown', uploadError.message, { cause: uploadError })

    const { error: rowError } = await this.client
      .from('attachments')
      .upsert({ id: attachmentId, vault_id: vaultId, note_id: noteId, storage_path: path, size: ciphertext.byteLength })
    if (rowError) throw toSyncError(rowError)
  }

  async downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null> {
    const { data, error } = await this.client.storage.from(BUCKET).download(storagePath(vaultId, attachmentId))
    if (error) {
      // supabase-js's StorageError carries no stable "not found" code across providers; treat any download
      // failure for a path we don't otherwise know about as "nothing there" rather than a hard error.
      return null
    }
    return new Uint8Array(await data.arrayBuffer())
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    await this.client.storage.from(BUCKET).remove([storagePath(vaultId, attachmentId)])
    const { error } = await this.client.from('attachments').delete().eq('vault_id', vaultId).eq('id', attachmentId)
    if (error) throw toSyncError(error)
  }

  async deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void> {
    const ids = await this.listAttachments(vaultId, noteId)
    if (ids.length === 0) return
    await this.client.storage.from(BUCKET).remove(ids.map((id) => storagePath(vaultId, id)))
    const { error } = await this.client.from('attachments').delete().eq('vault_id', vaultId).eq('note_id', noteId)
    if (error) throw toSyncError(error)
  }

  async listAttachments(vaultId: string, noteId: string): Promise<string[]> {
    const { data, error } = await this.client.from('attachments').select('id').eq('vault_id', vaultId).eq('note_id', noteId)
    if (error) throw toSyncError(error)
    return (data ?? []).map((r) => r.id as string)
  }
}

function toSyncError(e: { message: string; code?: string }): SyncError {
  return new SyncError('unknown', e.message, { cause: e })
}
