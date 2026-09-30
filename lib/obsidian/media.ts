import {
  deleteMediaAttachment,
  getMediaAttachment,
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

export function isMediaSupported(
  file: File
): boolean {
  return (
    SUPPORTED_IMAGE_TYPES.includes(
      file.type
    ) ||
    SUPPORTED_VIDEO_TYPES.includes(
      file.type
    )
  );
}

export function isVideoType(
  mimeType: string
): boolean {
  return SUPPORTED_VIDEO_TYPES.includes(
    mimeType
  );
}

/**
 * 將使用者拖曳或貼上的 File
 * 儲存至 IndexedDB。
 */
export async function saveUploadedMedia(
  file: File
): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  isVideo: boolean;
}> {
  if (!isMediaSupported(file)) {
    throw new Error(
      `不支援的檔案格式 (${file.type || "未知類型"})，僅支援常見圖片與影片`
    );
  }

  const id =
    `media-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const isVideo =
    isVideoType(file.type);

  const attachment: MediaAttachment = {
    id,
    filename: file.name,
    mimeType: file.type,
    blob: file,
    size: file.size,
    createdAt:
      new Date().toISOString(),
  };

  await saveMediaAttachment(
    attachment
  );

  return {
    id,
    filename: file.name,
    mimeType: file.type,
    isVideo,
  };
}

/**
 * 取得指定媒體的 Object URL。
 *
 * 已經建立過的 URL 會直接從快取取得。
 */
export async function resolveMediaUrl(
  id: string
): Promise<string | null> {
  const cachedUrl =
    activeUrlMap.get(id);

  if (cachedUrl) {
    return cachedUrl;
  }

  const record =
    await getMediaAttachment(id);

  if (
    !record ||
    !record.blob
  ) {
    return null;
  }

  const url =
    URL.createObjectURL(
      record.blob
    );

  activeUrlMap.set(
    id,
    url
  );

  return url;
}

/**
 * 刪除已儲存的媒體。
 *
 * 同時：
 * 1. revoke Object URL
 * 2. 從 URL cache 移除
 * 3. 從 IndexedDB 刪除
 */
export async function deleteSavedMedia(
  id: string
): Promise<void> {
  const activeUrl =
    activeUrlMap.get(id);

  if (activeUrl) {
    try {
      URL.revokeObjectURL(
        activeUrl
      );
    } catch {
      // 忽略 revoke 錯誤
    }

    activeUrlMap.delete(id);
  }

  await deleteMediaAttachment(
    id
  );
}

/**
 * 釋放所有已建立的 Object URL。
 */
export function revokeAllActiveMediaUrls(): void {
  for (const url of activeUrlMap.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // 忽略 revoke 錯誤
    }
  }

  activeUrlMap.clear();
}
