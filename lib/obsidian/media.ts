import {
  deleteMediaAttachment,
  getMediaAttachmentByReference,
  saveMediaAttachment,
} from "./db";
import { MediaAttachment } from "./types";

const activeUrlMap = new Map<string, string>();

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
];

export function isMediaSupported(_file: File): boolean {
  return true;
}

export function isImageType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();

  return (
    lower.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i.test(lower)
  );
}

export function isVideoType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();

  return (
    lower.startsWith("video/") ||
    /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(lower)
  );
}

export function isAudioType(mimeTypeOrExt: string): boolean {
  const lower = mimeTypeOrExt.toLowerCase();

  return (
    lower.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i.test(lower)
  );
}

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

  const mimeType = file.type || "application/octet-stream";
  const isVideo = isVideoType(mimeType || file.name);
  const isImage = isImageType(mimeType || file.name);
  const isAudio = isAudioType(mimeType || file.name);

  const attachment: MediaAttachment = {
    id,
    filename: file.name,
    mimeType,
    blob: file,
    size: file.size,
    createdAt: new Date().toISOString(),
  };

  await saveMediaAttachment(attachment);

  return {
    id,
    filename: file.name,
    mimeType,
    isVideo,
    isImage,
    isAudio,
    size: file.size,
  };
}

/**
 * ref 可以是新版 media ID，也可以是舊版 filename。
 */
export async function getMediaDetails(
  ref: string
): Promise<MediaAttachment | null> {
  return getMediaAttachmentByReference(ref);
}

export async function resolveMediaUrl(ref: string): Promise<string | null> {
  const cached = activeUrlMap.get(ref);
  if (cached) return cached;

  const record = await getMediaAttachmentByReference(ref);
  if (!record?.blob) return null;

  const existingById = activeUrlMap.get(record.id);
  if (existingById) {
    activeUrlMap.set(ref, existingById);
    return existingById;
  }

  const url = URL.createObjectURL(record.blob);

  activeUrlMap.set(record.id, url);
  activeUrlMap.set(ref, url);

  return url;
}

export function revokeMediaUrl(ref: string): void {
  const url = activeUrlMap.get(ref);
  if (!url) return;

  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }

  for (const [key, value] of activeUrlMap.entries()) {
    if (value === url) {
      activeUrlMap.delete(key);
    }
  }
}

export function revokeAllActiveMediaUrls(): void {
  const uniqueUrls = new Set(activeUrlMap.values());

  for (const url of uniqueUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  activeUrlMap.clear();
}

/**
 * 真正刪除 IndexedDB Blob。
 * ref 可傳 ID 或舊版 filename。
 */
export async function deleteSavedMedia(ref: string): Promise<{
  deletedId: string | null;
  filename: string | null;
}> {
  const record = await getMediaAttachmentByReference(ref);

  if (!record) {
    revokeMediaUrl(ref);

    return {
      deletedId: null,
      filename: null,
    };
  }

  revokeMediaUrl(ref);
  revokeMediaUrl(record.id);

  await deleteMediaAttachment(record.id);

  return {
    deletedId: record.id,
    filename: record.filename,
  };
}
