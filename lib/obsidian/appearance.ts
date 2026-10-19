/**
 * 外觀設定。
 * 設定值放 localStorage；背景圖片放獨立 IndexedDB，不與筆記附件混用。
 * 圖片使用固定的 custom-background 主鍵，每次上傳 put() 原位覆蓋。
 */

export type AppearanceMode = "ink" | "dark" | "custom";
export type AppearanceFit = "cover" | "contain";
export type AppearancePosition =
  | "center center"
  | "center top"
  | "center bottom"
  | "left center"
  | "right center";

export interface AppearancePreferences {
  mode: AppearanceMode;
  opacity: number;
  brightness: number;
  blur: number;
  fit: AppearanceFit;
  position: AppearancePosition;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  mode: "ink",
  opacity: 0.42,
  brightness: 0.85,
  blur: 0,
  fit: "cover",
  position: "center center",
};

const STORAGE_KEY = "web-obsidian-appearance-v1";
const DB_NAME = "WebObsidianAppearanceDB";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const BACKGROUND_ID = "custom-background";
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

interface BackgroundRecord {
  id: typeof BACKGROUND_ID;
  blob: Blob;
  filename: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openAppearanceDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("此瀏覽器無法使用 IndexedDB"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("背景資料庫開啟失敗"));
    };

    request.onblocked = () => {
      console.warn("背景資料庫升級等待其他分頁關閉");
    };
  });

  return dbPromise;
}

function within(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function loadAppearancePreferences(): AppearancePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_APPEARANCE };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };

    const value = JSON.parse(raw) as Partial<AppearancePreferences>;
    const mode: AppearanceMode =
      value.mode === "custom" || value.mode === "dark" ? value.mode : "ink";
    const fit: AppearanceFit = value.fit === "contain" ? "contain" : "cover";
    const allowedPositions: AppearancePosition[] = [
      "center center", "center top", "center bottom", "left center", "right center",
    ];

    return {
      mode,
      opacity: within(value.opacity, 0.05, 1, DEFAULT_APPEARANCE.opacity),
      brightness: within(value.brightness, 0.35, 1.5, DEFAULT_APPEARANCE.brightness),
      blur: within(value.blur, 0, 16, DEFAULT_APPEARANCE.blur),
      fit,
      position: allowedPositions.includes(value.position as AppearancePosition)
        ? value.position as AppearancePosition
        : DEFAULT_APPEARANCE.position,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearancePreferences(value: AppearancePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function getCustomBackground(): Promise<BackgroundRecord | null> {
  const db = await openAppearanceDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(BACKGROUND_ID);
    request.onsuccess = () => resolve((request.result as BackgroundRecord) || null);
    request.onerror = () => reject(request.error);
  });
}

export async function replaceCustomBackground(file: File): Promise<void> {
  if (!IMAGE_TYPES.has(file.type)) {
    throw new Error("請選擇 JPG、PNG、WEBP、GIF 或 AVIF 圖片");
  }
  if (file.size === 0) throw new Error("圖片內容不可為空白");
  if (file.size > MAX_BACKGROUND_BYTES) {
    throw new Error("單張背景圖片不可超過 20 MB");
  }

  const db = await openAppearanceDB();
  const record: BackgroundRecord = {
    id: BACKGROUND_ID,
    blob: file,
    filename: file.name,
    updatedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    // 同一個固定主鍵：新圖成功儲存時，舊圖即被取代，不會累積。
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteCustomBackground(): Promise<void> {
  const db = await openAppearanceDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(BACKGROUND_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
