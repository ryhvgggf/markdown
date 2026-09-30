import {
  deleteMediaAttachment,
  getMediaAttachment,
  saveMediaAttachment,
} from "./db";

import {
  MediaAttachment,
} from "./types";

/**
 * 目前已建立的 Blob Object URL。
 *
 * key   = media ID
 * value = blob:xxxxxx URL
 */
const activeUrlMap =
  new Map<string, string>();

/**
 * 支援的圖片格式。
 */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

/**
 * 支援的影片格式。
 */
export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
];

/**
 * 判斷是否為支援的圖片 / 影片。
 */
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

/**
 * 判斷 MIME Type 是否為影片。
 */
export function isVideoType(
  mimeType: string
): boolean {
  return SUPPORTED_VIDEO_TYPES.includes(
    mimeType
  );
}

/**
 * 將使用者上傳的圖片 / 影片
 * 儲存進 IndexedDB。
 */
export async function saveUploadedMedia(
  file: File
): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  isVideo: boolean;
}> {
  /**
   * 檢查格式。
   */
  if (!isMediaSupported(file)) {
    throw new Error(
      `不支援的檔案格式 (${file.type || "未知格式"})`
    );
  }

  /**
   * 每一個媒體產生唯一 ID。
   */
  const id =
    `media-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const isVideo =
    isVideoType(file.type);

  /**
   * 建立 IndexedDB 媒體物件。
   */
  const attachment: MediaAttachment = {
    id,
    filename: file.name,
    mimeType: file.type,
    blob: file,
    size: file.size,
    createdAt:
      new Date().toISOString(),
  };

  /**
   * 寫入 IndexedDB。
   */
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
 * 依 media ID 取得 Blob URL。
 *
 * 例如：
 *
 * media-123abc
 * ↓
 * IndexedDB Blob
 * ↓
 * blob:https://...
 */
export async function resolveMediaUrl(
  id: string
): Promise<string | null> {
  /**
   * 已建立過 URL 就直接沿用。
   */
  const existingUrl =
    activeUrlMap.get(id);

  if (existingUrl) {
    return existingUrl;
  }

  /**
   * 從 IndexedDB 取得媒體。
   */
  const record =
    await getMediaAttachment(id);

  if (
    !record ||
    !record.blob
  ) {
    return null;
  }

  /**
   * Blob → 瀏覽器可顯示 URL。
   */
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
 * 刪除圖片 / 影片。
 *
 * 會：
 *
 * 1. 從 IndexedDB 刪除真正 Blob
 * 2. 釋放 Object URL
 * 3. 從 activeUrlMap 移除
 */
export async function deleteSavedMedia(
  id: string
): Promise<void> {
  if (!id) {
    return;
  }

  /**
   * 先刪除 IndexedDB 裡的資料。
   */
  await deleteMediaAttachment(id);

  /**
   * 如果目前有 Blob URL，
   * 同時釋放。
   */
  const activeUrl =
    activeUrlMap.get(id);

  if (activeUrl) {
    try {
      URL.revokeObjectURL(
        activeUrl
      );
    } catch (error) {
      console.warn(
        "釋放媒體 URL 失敗:",
        error
      );
    }

    activeUrlMap.delete(id);
  }
}

/**
 * 釋放單一媒體的 Blob URL。
 *
 * 注意：
 * 只釋放 URL，
 * 不會刪掉 IndexedDB 裡的檔案。
 */
export function revokeMediaUrl(
  id: string
): void {
  const url =
    activeUrlMap.get(id);

  if (!url) {
    return;
  }

  try {
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn(
      "釋放媒體 URL 失敗:",
      error
    );
  }

  activeUrlMap.delete(id);
}

/**
 * 釋放目前所有 Blob URL。
 *
 * 通常在 Component 卸載時執行，
 * 避免瀏覽器記憶體洩漏。
 *
 * 不會刪除 IndexedDB 裡的圖片 / 影片。
 */
export function revokeAllActiveMediaUrls(): void {
  for (
    const [
      id,
      url,
    ] of activeUrlMap.entries()
  ) {
    try {
      URL.revokeObjectURL(
        url
      );
    } catch (error) {
      console.warn(
        `釋放媒體 URL 失敗：${id}`,
        error
      );
    }
  }

  activeUrlMap.clear();
}
