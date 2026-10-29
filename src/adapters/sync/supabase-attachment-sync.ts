import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentSyncAdapter } from './attachment-types'
import { SyncError } from './types'

/** Private Storage bucket holding encrypted attachment blobs (set up by supabase/migrations/0002). */
const BUCKET = 'attachments'

const storagePath = (vaultId: string, attachmentId: string) => `${vaultId}/${attachmentId}`

/**
 * Real `AttachmentSyncAdapter`: ciphertext lives in Supabase Storage; the `attachment_refs` table only
 * records which synced notes use which attachment, so turning one note's sync off can tell whether a blob
 * is still needed by another note. Blobs are always removed *before* the refs that point at them, and a
 * failed removal throws: an interrupted delete then leaves refs to retry from, never an unreferenced blob
 * nothing would ever clean up.
 */
export class SupabaseAttachmentSync implements AttachmentSyncAdapter {
  constructor(private client: SupabaseClient) {}

  async uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void> {
    const path = storagePath(vaultId, attachmentId)
    const { error: uploadError } = await this.client.storage.from(BUCKET).upload(path, ciphertext, { upsert: true })
    if (uploadError) throw toStorageSyncError(uploadError)

    const { error: rowError } = await this.client
      .from('attachment_refs')
      .upsert({ vault_id: vaultId, attachment_id: attachmentId, note_id: noteId, size: ciphertext.byteLength })
    if (rowError) throw toSyncError(rowError)
  }

  async downloadAttachment(vaultId: string, attachmentId: string): Promise<Uint8Array | null> {
    const { data, error } = await this.client.storage.from(BUCKET).download(storagePath(vaultId, attachmentId))
    if (error) {
      if (isNotFound(error)) return null
      throw toStorageSyncError(error)
    }
    return new Uint8Array(await data.arrayBuffer())
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    await this.removeBlobs(vaultId, [attachmentId])
    const { error } = await this.client.from('attachment_refs').delete().eq('vault_id', vaultId).eq('attachment_id', attachmentId)
    if (error) throw toSyncError(error)
  }

  async deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void> {
    const ids = await this.listAttachments(vaultId, noteId)
    if (ids.length === 0) return
    const { data: others, error: othersError } = await this.client
      .from('attachment_refs')
      .select('attachment_id')
      .eq('vault_id', vaultId)
      .in('attachment_id', ids)
      .neq('note_id', noteId)
    if (othersError) throw toSyncError(othersError)
    const stillUsed = new Set((others ?? []).map((r) => r.attachment_id as string))
    // Known gap for 3d: another device could add a ref between this check and the removal below.
    await this.removeBlobs(
      vaultId,
      ids.filter((id) => !stillUsed.has(id)),
    )
    const { error } = await this.client.from('attachment_refs').delete().eq('vault_id', vaultId).eq('note_id', noteId)
    if (error) throw toSyncError(error)
  }

  async listAttachments(vaultId: string, noteId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('attachment_refs')
      .select('attachment_id')
      .eq('vault_id', vaultId)
      .eq('note_id', noteId)
    if (error) throw toSyncError(error)
    return (data ?? []).map((r) => r.attachment_id as string)
  }

  private async removeBlobs(vaultId: string, attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return
    const { error } = await this.client.storage.from(BUCKET).remove(attachmentIds.map((id) => storagePath(vaultId, id)))
    if (error) throw toStorageSyncError(error)
  }
}

/** Supabase Storage reports a missing object as HTTP 404, or as 400 with `statusCode: '404'` in the body. */
function isNotFound(e: unknown): boolean {
  const { status, statusCode } = e as { status?: number; statusCode?: string }
  return status === 404 || statusCode === '404'
}

/** Storage errors without an HTTP status never reached the server (network down, request aborted). */
function toStorageSyncError(e: unknown): SyncError {
  const { status, message } = e as { status?: number; message?: string }
  return new SyncError(status === undefined ? 'offline' : 'unknown', message, { cause: e })
}

function toSyncError(e: { message: string; code?: string }): SyncError {
  return new SyncError('unknown', e.message, { cause: e })
}
