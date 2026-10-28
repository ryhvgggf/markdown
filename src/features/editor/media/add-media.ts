import type { StorageAdapter } from '@/adapters/storage/types'
import { isSvg, MAX_ATTACHMENT_BYTES, mediaKind, type MediaKind } from '@/core/attachments'
import type { Vault } from '@/core/vault/vault'

export { isSvg, MAX_ATTACHMENT_BYTES, mediaKind, type MediaKind }

export class MediaError extends Error {
  constructor(
    public code: 'too-large' | 'unsupported',
    message: string,
  ) {
    super(message)
    this.name = 'MediaError'
  }
}

export const SVG_REJECTED = '不支援 SVG 圖片，請改用 PNG、JPEG 或 GIF。'
/** Validates, then stores a file as an attachment (images and videos are shown; other types become file blocks). Nothing is written when validation fails; no metadata is left behind when the blob write fails. */
export async function addMedia(
  file: File,
  deps: { vault: Vault; storage: StorageAdapter },
): Promise<{ attachmentId: string; kind: MediaKind }> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new MediaError('too-large', '檔案超過 100 MB，無法加入。')
  if (isSvg(file.type, file.name)) throw new MediaError('unsupported', SVG_REJECTED)
  const kind = mediaKind(file.type)
  const meta = deps.vault.addAttachment({ filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size })
  try {
    await deps.storage.putBlob(meta.id, file)
  } catch (e) {
    deps.vault.removeAttachment(meta.id)
    throw e
  }
  return { attachmentId: meta.id, kind }
}
