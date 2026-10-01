import { deleteMediaAttachment, getMediaAttachment, saveMediaAttachment } from "./db";
import { MediaAttachment } from "./types";

const activeUrlMap = new Map<string, string>();

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
export const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];

export function isMediaSupported(file: File): boolean {
  return true; // 支援所有任意格式檔案
}

export function isImageType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();
  return lower.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i.test(lower);
}

export function isVideoType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();
  return lower.startsWith("video/") || /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(lower);
}

export function isAudioType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();
  return lower.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i.test(lower);
}

/**
 * 將使用者拖曳、選取或貼上的任意 File 物件儲存至 IndexedDB
 */
export async function saveUploadedMedia(file: File): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  isVideo: boolean;
  isImage: boolean;
  isAudio: boolean;
  size: number;
}> {
  const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isVideo = isVideoType(file.type || file.name);
  const isImage = isImageType(file.type || file.name);
  const isAudio = isAudioType(file.type || file.name);

  const attachment: MediaAttachment = {
    id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    blob: file,
    size: file.size,
    createdAt: new Date().toISOString(),
  };

  await saveMediaAttachment(attachment);

  return {
    id,
    filename: file.name,
    mimeType: attachment.mimeType,
    isVideo,
    isImage,
    isAudio,
    size: file.size,
  };
}

/**
 * 取得指定媒體的 Object URL，並記錄於快取池以便後續釋放
 */
export async function resolveMediaUrl(id: string): Promise<string | null> {
  if (activeUrlMap.has(id)) {
    return activeUrlMap.get(id)!;
  }

  const record = await getMediaAttachment(id);
  if (!record || !record.blob) return null;

  const url = URL.createObjectURL(record.blob);
  activeUrlMap.set(id, url);
  return url;
}

/**
 * 取得媒體附件完整記錄 (包含檔名與大小)
 */
export async function getMediaDetails(id: string): Promise<MediaAttachment | null> {
  return getMediaAttachment(id);
}

/**
 * 釋放所有已開啟之 Object URL，徹底防止記憶體洩漏
 */
export function revokeAllActiveMediaUrls(): void {
  for (const [id, url] of activeUrlMap.entries()) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      // 忽略錯誤
    }
  }
  activeUrlMap.clear();
}
