import type { StorageAdapter } from '@/adapters/storage/types'
import type { Vault } from '@/core/vault/vault'

export const MAX_ATTACHMENT_BYTES = 104_857_600

export class MediaError extends Error {
  constructor(
    public code: 'too-large' | 'unsupported',
    message: string,
  ) {
    super(message)
    this.name = 'MediaError'
  }
}

export type MediaKind = 'image' | 'video'

export function mediaKind(mimeType: string): MediaKind | null {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return null
}

/** Validates, then stores a file as an attachment. Nothing is written when validation fails; no metadata is left behind when the blob write fails. */
export async function addMedia(
  file: File,
  deps: { vault: Vault; storage: StorageAdapter },
): Promise<{ attachmentId: string; kind: MediaKind }> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new MediaError('too-large', '檔案超過 100 MB，無法加入。')
  const kind = mediaKind(file.type)
  if (!kind) throw new MediaError('unsupported', '目前只支援圖片與影片。')
  const meta = deps.vault.addAttachment({ filename: file.name, mimeType: file.type, size: file.size })
  try {
    await deps.storage.putBlob(meta.id, file)
  } catch (e) {
    deps.vault.removeAttachment(meta.id)
    throw e
  }
  return { attachmentId: meta.id, kind }
}
