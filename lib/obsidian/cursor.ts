/**
 * 游標設定 / 游標附件儲存。
 * 與三區背景共用 WebObsidianAppearanceDB 中的 assets store。
 * 游標使用唯一主鍵 custom-cursor，每次上傳會取代上一個檔案。
 * 不接觸筆記 WebObsidianDB。
 */
export type CursorMode = "system" | "sparkle" | "custom";

export type CursorFileKind = "static" | "animated" | "ani";

export interface CursorPreferences {
  mode: CursorMode;
  size: number;             // 游標顯示的 CSS 像素
  hotspotX: number;         // 點擊點 X (0~100%)
  hotspotY: number;         // 點擊點 Y (0~100%)
  preserveTextCursor: boolean;
}

export interface CursorAssetRecord {
  id: "custom-cursor";
  filename: string;
  blob: Blob;
  kind: CursorFileKind;
  updatedAt: string;
}

export interface AniFrame {
  image: Blob;              // 轉為 browser 可繪製的 ICO
  delayMs: number;
}

export const CURSOR_CHANGED_EVENT = "obsidian-cursor-changed";
export const MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const MAX_CURSOR_ZIP_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_CURSOR_EXTENSIONS = [
  ".cur", ".ani", ".ico", ".png", ".apng",
  ".gif", ".webp", ".jpg", ".jpeg",
];

const CURSOR_STORAGE_KEY = "web-obsidian-cursor-v1";
const CURSOR_ID = "custom-cursor" as const;
const DB_NAME = "WebObsidianAppearanceDB";
const DB_VERSION = 1;
const STORE_NAME = "assets";

export const DEFAULT_CURSOR_PREFERENCES: CursorPreferences = {
  mode: "system",
  size: 40,
  hotspotX: 0,
  hotspotY: 0,
  preserveTextCursor: true,
};

const MODES: CursorMode[] = ["system", "sparkle", "custom"];

export const CURSOR_PRESETS: Array<{
  mode: CursorMode;
  label: string;
  description: string;
  icon: string;
}> = [
  { mode: "sparkle", label: "星芒", description: "柔和亮色星形游標", icon: "✦" },
];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

export function readCursorPreferences(): CursorPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_CURSOR_PREFERENCES };
  try {
    const value = JSON.parse(localStorage.getItem(CURSOR_STORAGE_KEY) || "null") as Partial<CursorPreferences> | null;
    if (!value || typeof value !== "object") return { ...DEFAULT_CURSOR_PREFERENCES };
    return {
      mode: MODES.includes(value.mode as CursorMode)
        ? value.mode as CursorMode : DEFAULT_CURSOR_PREFERENCES.mode,
      size: clamp(value.size, 16, 96, DEFAULT_CURSOR_PREFERENCES.size),
      hotspotX: clamp(value.hotspotX, 0, 100, 0),
      hotspotY: clamp(value.hotspotY, 0, 100, 0),
      preserveTextCursor: typeof value.preserveTextCursor === "boolean"
        ? value.preserveTextCursor : true,
    };
  } catch {
    return { ...DEFAULT_CURSOR_PREFERENCES };
  }
}

export function saveCursorPreferences(preferences: CursorPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CURSOR_STORAGE_KEY, JSON.stringify(preferences));
  notifyCursorChanged();
}

export function notifyCursorChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CURSOR_CHANGED_EVENT));
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openCursorDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("此瀏覽器不支援 IndexedDB"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("開啟游標資料庫失敗"));
    };
  });
  return dbPromise;
}

export async function getSavedCursor(): Promise<CursorAssetRecord | null> {
  const db = await openCursorDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(CURSOR_ID);
    request.onsuccess = () => resolve((request.result as CursorAssetRecord | undefined) || null);
    request.onerror = () => reject(request.error || new Error("讀取游標失敗"));
  });
}

export async function replaceSavedCursor(file: File, kind: CursorFileKind): Promise<void> {
  if (!file.size || file.size > MAX_CURSOR_BYTES) throw new Error("游標檔案必須小於 8 MB，且不能為空白");
  const db = await openCursorDB();
  const record: CursorAssetRecord = {
    id: CURSOR_ID,
    filename: file.name,
    blob: file,
    kind,
    updatedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("儲存游標失敗"));
    transaction.onabort = () => reject(transaction.error || new Error("儲存游標已取消"));
  });
  notifyCursorChanged();
}

export async function deleteSavedCursor(): Promise<void> {
  const db = await openCursorDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(CURSOR_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("刪除游標失敗"));
    transaction.onabort = () => reject(transaction.error || new Error("刪除游標已取消"));
  });
  notifyCursorChanged();
}

/** 將 TypedArray 複製成 ArrayBuffer，兼容 TypeScript 5.9+ BlobPart 型別。 */
export function cursorBytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return copied.buffer as ArrayBuffer;
}

const readU32 = (v: DataView, offset: number): number => v.getUint32(offset, true);
const fourcc = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * ANI (RIFF ACON) 取出各影格及延遲。
 * 支援 Windows 標準 .ani 內嵌的 CUR/ICO 影格。
 * 有些罕見 .ani 將 DIB 直接放入 icon chunk，瀏覽器無法繪製時會給錯誤提示。
 */
export async function parseAniCursor(blob: Blob): Promise<AniFrame[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 12 || fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "ACON") {
    throw new Error("不是有效的 Windows ANI 動態游標");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: Uint8Array[] = [];
  let rates: number[] = [];
  let sequence: number[] = [];
  let defaultRate = 6;
  let headerSteps = 0;
  let cursorIconFlag = true;

  function walk(start: number, end: number, depth: number) {
    if (depth > 5) return;
    let offset = start;
    while (offset + 8 <= end && offset + 8 <= bytes.length) {
      const tag = fourcc(bytes, offset);
      const size = readU32(view, offset + 4);
      const data = offset + 8;
      const stop = data + size;
      if (!Number.isSafeInteger(stop) || stop > bytes.length || stop > end) {
        throw new Error("ANI 影格長度損壞或格式不完整");
      }
      if ((tag === "LIST" || tag === "RIFF") && size >= 4) {
        walk(data + 4, stop, depth + 1);
      } else if (tag === "anih" && size >= 36) {
        headerSteps = readU32(view, data + 8);
        defaultRate = readU32(view, data + 28) || 6;
        cursorIconFlag = (readU32(view, data + 32) & 1) !== 0;
      } else if (tag === "rate") {
        rates = [];
        for (let i = data; i + 4 <= stop && rates.length < 512; i += 4) rates.push(readU32(view, i));
      } else if (tag === "seq ") {
        sequence = [];
        for (let i = data; i + 4 <= stop && sequence.length < 512; i += 4) sequence.push(readU32(view, i));
      } else if (tag === "icon") {
        if (frames.length >= 128) throw new Error("ANI 影格過多（最多 128 格）");
        frames.push(bytes.slice(data, stop));
      }
      offset = stop + (size & 1);
    }
  }

  const fileStop = Math.min(bytes.length, 8 + readU32(view, 4));
  walk(12, fileStop, 0);
  if (!frames.length) throw new Error("ANI 檔案沒有可播放的影格");
  if (!cursorIconFlag) throw new Error("這個 ANI 使用非標準 DIB 影格，暫時不支援，請轉成 GIF 或 APNG 再匯入");

  const count = Math.min(headerSteps || sequence.length || frames.length, 512);
  const result: AniFrame[] = [];
  for (let step = 0; step < count; step++) {
    const index = sequence.length ? sequence[step % sequence.length] : step % frames.length;
    const raw = frames[index];
    if (!raw) throw new Error(`ANI 引用了不存在的影格 ${index}`);
    const normalized = normalizeIconBytes(raw);
    const ticks = rates[step] || defaultRate;
    const delayMs = Math.max(20, Math.min(2500, Math.round(ticks * 1000 / 60)));
    result.push({ image: new Blob([cursorBytesToBuffer(normalized)], { type: "image/x-icon" }), delayMs });
  }
  return result;
}

/** 把 CUR (type=2) 的目錄調整為 ICO (type=1)，使影格可以當圖片播放。 */
export function normalizeIconBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 22 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[3] !== 0) {
    throw new Error("CUR/ICO 檔案標頭無效");
  }
  const type = bytes[2];
  if (type !== 1 && type !== 2) throw new Error("不支援的 CUR/ICO 格式");
  const count = bytes[4] | (bytes[5] << 8);
  if (count < 1 || count > 100 || bytes.length < 6 + count * 16) {
    throw new Error("CUR/ICO 目錄損壞");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const len = view.getUint32(base + 8, true);
    const offset = view.getUint32(base + 12, true);
    if (!len || offset + len > bytes.length) throw new Error("CUR/ICO 影格資料長度錯誤");
  }
  if (type === 1) return bytes.slice();
  const result = bytes.slice();
  result[2] = 1;
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    // CUR 的這四個 byte 是 hotspot 而非 planes/bit depth。
    // 轉成 ICO 要寫成 planes=1 / bits=32。
    result[offset + 4] = 1;
    result[offset + 5] = 0;
    result[offset + 6] = 32;
    result[offset + 7] = 0;
  }
  return result;
}

export function getCursorExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

export async function validateCursorFile(file: File): Promise<CursorFileKind> {
  if (file.size <= 0 || file.size > MAX_CURSOR_BYTES) {
    throw new Error("游標檔案大小不可超過 8 MB，且不能為空白");
  }
  const ext = getCursorExtension(file.name);
  if (!ACCEPTED_CURSOR_EXTENSIONS.includes(ext)) {
    throw new Error("支援 CUR、ICO、ANI、PNG/APNG、GIF、WebP、JPG；ZIP 可以匯入包含這些格式的游標包");
  }
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const prefix = header.length >= 4 ? fourcc(header, 0) : "";
  if (ext === ".ani") {
    await parseAniCursor(file);
    return "ani";
  }
  if (ext === ".cur" || ext === ".ico") {
    normalizeIconBytes(new Uint8Array(await file.arrayBuffer()));
    return "static";
  }
  if (ext === ".png" || ext === ".apng") {
    if (!header.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
      throw new Error("PNG 檔案標頭無效");
    }
    const array = new Uint8Array(await file.arrayBuffer());
    // PNG 動畫標記：acTL chunk。只掃描 chunk header，避免誤判圖片內容。
    let offset = 8;
    while (offset + 12 <= array.length) {
      const v = new DataView(array.buffer, array.byteOffset, array.byteLength);
      const size = v.getUint32(offset, false);
      if (offset + size + 12 > array.length) break;
      if (fourcc(array, offset + 4) === "acTL") return "animated";
      if (fourcc(array, offset + 4) === "IDAT") break;
      offset += size + 12;
    }
    return "static";
  }
  if (ext === ".gif") {
    if (prefix !== "GIF8") throw new Error("GIF 檔案標頭無效");
    return "animated";
  }
  if (ext === ".webp") {
    if (prefix !== "RIFF" || fourcc(header, 8) !== "WEBP") throw new Error("WebP 檔案標頭無效");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return fourcc(bytes, 12) === "VP8X" && (bytes[20] & 2) ? "animated" : "static";
  }
  if ((ext === ".jpg" || ext === ".jpeg") && !(header[0] === 0xff && header[1] === 0xd8)) {
    throw new Error("JPG 檔案標頭無效");
  }
  return "static";
}

/** 唯一內建造型為星芒；系統預設與自訂檔案另行處理。 */
export function makeBuiltInCursorCss(mode: CursorMode, size: number): string {
  if (mode !== "sparkle") return "auto";
  const sz = Math.round(Math.max(16, Math.min(96, size)));
  const path = '<path d="M23 2 L28 17 L44 22 L28 27 L23 44 L18 27 L2 22 L18 17 Z" fill="#e9dfb8" stroke="#31564d" stroke-width="2.2"/><circle cx="23" cy="22" r="4" fill="#fff"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 48 48">${path}</svg>`;
  const hotspotX = Math.round(sz * 23 / 48);
  const hotspotY = Math.round(sz * 22 / 48);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspotX} ${hotspotY}, auto`;
}
