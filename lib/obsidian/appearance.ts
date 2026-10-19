/**
 * 外觀設定 v2：左／中／右三塊背景各自獨立。
 * - 圖檔存獨立 IndexedDB；同區固定 ID，替換即覆蓋，不累積舊圖。
 * - 透明度／亮度／模糊程度分區保存在 localStorage。
 * - 不改 WebObsidianDB 的筆記與 media 資料。
 * - 兼容舊版單張背景：首次讀取時遷移到「中間背景」。
 */

export type BackgroundZone = "left" | "center" | "right";

export interface BackgroundEffect {
  opacity: number;
  brightness: number;
  blur: number;
}

export interface AppearancePreferences {
  effects: Record<BackgroundZone, BackgroundEffect>;
}

export const BACKGROUND_ZONES: BackgroundZone[] = [
  "left",
  "center",
  "right",
];

export const BACKGROUND_INFO: Record<
  BackgroundZone,
  { title: string; description: string; width: number; height: number }
> = {
  left: {
    title: "左側背景圖",
    description: "檔案庫／資料夾區域",
    width: 720,
    height: 1200,
  },
  center: {
    title: "中間背景圖",
    description: "筆記編輯／閱讀區域",
    width: 1600,
    height: 1000,
  },
  right: {
    title: "右側背景圖",
    description: "關聯／資訊面板區域",
    width: 720,
    height: 1200,
  },
};

const DEFAULT_EFFECT: BackgroundEffect = {
  opacity: 0.42,
  brightness: 0.85,
  blur: 0,
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  effects: {
    left: { ...DEFAULT_EFFECT },
    center: { ...DEFAULT_EFFECT },
    right: { ...DEFAULT_EFFECT },
  },
};

const STORAGE_KEY = "web-obsidian-appearance-v2";
const LEGACY_STORAGE_KEY = "web-obsidian-appearance-v1";
const DB_NAME = "WebObsidianAppearanceDB";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const LEGACY_BACKGROUND_ID = "custom-background";

export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export interface BackgroundRecord {
  id: string;
  blob: Blob;
  filename: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function backgroundId(zone: BackgroundZone): string {
  return `background-${zone}`;
}

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
  });

  return dbPromise;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function sanitizeEffect(value: unknown): BackgroundEffect {
  const source = value && typeof value === "object"
    ? (value as Partial<BackgroundEffect>)
    : {};
  return {
    opacity: clampNumber(source.opacity, 0.05, 1, DEFAULT_EFFECT.opacity),
    brightness: clampNumber(source.brightness, 0.35, 1.5, DEFAULT_EFFECT.brightness),
    blur: clampNumber(source.blur, 0, 16, DEFAULT_EFFECT.blur),
  };
}

export function loadAppearancePreferences(): AppearancePreferences {
  if (typeof window === "undefined") {
    return {
      effects: {
        left: { ...DEFAULT_EFFECT },
        center: { ...DEFAULT_EFFECT },
        right: { ...DEFAULT_EFFECT },
      },
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppearancePreferences>;
      return {
        effects: {
          left: sanitizeEffect(saved.effects?.left),
          center: sanitizeEffect(saved.effects?.center),
          right: sanitizeEffect(saved.effects?.right),
        },
      };
    }

    // 舊版的透明度等設定延續在「中間背景」。
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<BackgroundEffect>;
      return {
        effects: {
          left: { ...DEFAULT_EFFECT },
          center: sanitizeEffect(legacy),
          right: { ...DEFAULT_EFFECT },
        },
      };
    }
  } catch (error) {
    console.warn("讀取外觀設定失敗，使用預設設定", error);
  }

  return {
    effects: {
      left: { ...DEFAULT_EFFECT },
      center: { ...DEFAULT_EFFECT },
      right: { ...DEFAULT_EFFECT },
    },
  };
}

export function saveAppearancePreferences(prefs: AppearancePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * 轉換舊版單張背景為中間背景（同一交易刪除舊 ID）。
 * 如果中間已有新版圖片，以新版為準，仍清除舊檔。
 */
export async function migrateLegacyBackground(): Promise<void> {
  const db = await openAppearanceDB();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const currentRequest = store.get(backgroundId("center"));
    const legacyRequest = store.get(LEGACY_BACKGROUND_ID);

    let current: BackgroundRecord | undefined;
    let legacy: BackgroundRecord | undefined;
    let completed = 0;

    const maybeMigrate = () => {
      completed += 1;
      if (completed < 2) return;

      if (legacy) {
        if (!current) {
          store.put({ ...legacy, id: backgroundId("center") });
        }
        store.delete(LEGACY_BACKGROUND_ID);
      }
    };

    currentRequest.onsuccess = () => {
      current = currentRequest.result as BackgroundRecord | undefined;
      maybeMigrate();
    };
    legacyRequest.onsuccess = () => {
      legacy = legacyRequest.result as BackgroundRecord | undefined;
      maybeMigrate();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("舊背景轉換失敗"));
    tx.onabort = () => reject(tx.error || new Error("舊背景轉換已取消"));
  });
}

export async function getCustomBackground(
  zone: BackgroundZone
): Promise<BackgroundRecord | null> {
  const db = await openAppearanceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(backgroundId(zone));
    req.onsuccess = () => resolve((req.result as BackgroundRecord) || null);
    req.onerror = () => reject(req.error);
  });
}

/** 同區固定主鍵：成功存新圖時，舊圖即由 IndexedDB 直接覆蓋。 */
export async function replaceCustomBackground(
  zone: BackgroundZone,
  blob: Blob,
  filename: string
): Promise<void> {
  if (!blob.type.startsWith("image/")) {
    throw new Error("背景檔案必須是圖片");
  }
  if (blob.size <= 0) throw new Error("圖片內容不可為空白");
  if (blob.size > MAX_BACKGROUND_BYTES) {
    throw new Error("背景圖片不可超過 20 MB");
  }

  const db = await openAppearanceDB();
  const item: BackgroundRecord = {
    id: backgroundId(zone),
    blob,
    filename,
    updatedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteCustomBackground(zone: BackgroundZone): Promise<void> {
  const db = await openAppearanceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(backgroundId(zone));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteAllCustomBackgrounds(): Promise<void> {
  const db = await openAppearanceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const zone of BACKGROUND_ZONES) store.delete(backgroundId(zone));
    store.delete(LEGACY_BACKGROUND_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
