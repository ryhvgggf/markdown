import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentSyncAdapter } from './attachment-types'
import { SyncError } from './types'

/** Private Storage bucket holding encrypted attachment blobs (set up by supabase/migrations/0002). */
const BUCKET = 'attachments'

const storagePath = (vaultId: string, attachmentId: string) => `${vaultId}/${attachmentId}`

/**
 * Real `AttachmentSyncAdapter`: ciphertext lives in Supabase Storage; the `attachment_refs` table only
 * records which synced notes use which attachment, so turning one note's sync off can tell whether a blob
 * is still needed by another note.
 *
 * `deleteAttachment` (removing one attachment outright) still removes the blob *before* its refs, and a
 * failed removal throws: an interrupted delete leaves refs to retry from, never an unreferenced blob
 * nothing would clean up. `deleteAttachmentsForNote` (turning sync off for a note) is the other way around
 * — refs go first, atomically, via `reap_note_attachment_refs` — because computing "is anyone else still
 * using this" has to happen in the same transaction as removing this note's own ref, or it's not actually
 * atomic; see that method's comment.
 */
export class SupabaseAttachmentSync implements AttachmentSyncAdapter {
  constructor(private client: SupabaseClient) {}

  async uploadAttachment(vaultId: string, noteId: string, attachmentId: string, ciphertext: Uint8Array): Promise<void> {
    const path = storagePath(vaultId, attachmentId)
    const { error: uploadError } = await this.client.storage.from(BUCKET).upload(path, ciphertext, { upsert: true })
    if (uploadError) throw toStorageSyncError(uploadError)

    // `add_attachment_ref` (migration 0003) takes the same per-attachment advisory lock as
    // `reap_note_attachment_refs` below, so this insert can never interleave with another device's
    // "is anyone still using this?" check — see that function's comment for the (small, documented) gap
    // that locking the DB row alone can't close.
    const { error: rowError } = await this.client.rpc('add_attachment_ref', {
      p_vault_id: vaultId,
      p_attachment_id: attachmentId,
      p_note_id: noteId,
      p_size: ciphertext.byteLength,
    })
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

  /**
   * 3d fix for the race 3c flagged: "check who else uses it, then delete" used to be two round trips with
   * nothing stopping another device's `uploadAttachment` from adding a fresh ref to one of these attachment
   * ids in between, in which case the blob removal below would delete something now back in use.
   *
   * `reap_note_attachment_refs` (migration 0003) closes the database side of that: deleting this note's
   * refs and computing which attachment ids are now unused happens in one transaction, serialized against
   * `add_attachment_ref` by the same per-attachment advisory lock, so the two can never interleave *in the
   * database*. What's left is a narrower, genuinely hard-to-close gap: the Storage blob removal below is a
   * separate call after that transaction has already committed, so a ref-add landing in that specific
   * window would still see its blob deleted out from under it. `removeBlobs` re-checks each id for a ref
   * right before removing it to shrink that window as far as it goes without a distributed lock held across
   * the Storage call too — which would be disproportionate here. Documented, not silently left as 3c's gap.
   */
  async deleteAttachmentsForNote(vaultId: string, noteId: string): Promise<void> {
    const { data, error } = await this.client.rpc('reap_note_attachment_refs', { p_vault_id: vaultId, p_note_id: noteId })
    if (error) throw toSyncError(error)
    const orphaned = (data ?? []).map((r: { attachment_id: string }) => r.attachment_id)
    await this.removeBlobs(vaultId, orphaned, { recheck: true })
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

  /**
   * `recheck`: re-reads each id's ref count right before removing it and drops any that now have a ref
   * (see `deleteAttachmentsForNote`'s comment — the residual window this narrows). Not used by
   * `deleteAttachment`, whose caller is deleting that attachment outright, not "whichever ones nobody
   * uses" — there's nothing to race against there.
   */
  private async removeBlobs(vaultId: string, attachmentIds: string[], opts: { recheck?: boolean } = {}): Promise<void> {
    if (attachmentIds.length === 0) return
    let ids = attachmentIds
    if (opts.recheck) {
      const { data: reclaimed, error } = await this.client
        .from('attachment_refs')
        .select('attachment_id')
        .eq('vault_id', vaultId)
        .in('attachment_id', attachmentIds)
      if (error) throw toSyncError(error)
      const stillUsed = new Set((reclaimed ?? []).map((r) => r.attachment_id as string))
      ids = attachmentIds.filter((id) => !stillUsed.has(id))
      if (ids.length === 0) return
    }
    const { error } = await this.client.storage.from(BUCKET).remove(ids.map((id) => storagePath(vaultId, id)))
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
