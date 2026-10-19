/**
 * 游標設定、單一游標相容層與完整游標主題儲存。
 * 使用 WebObsidianAppearanceDB 的 assets store，不接觸筆記資料庫。
 */
export type CursorMode = "system" | "custom";
export type CursorFileKind = "static" | "animated" | "ani";

export const CURSOR_ROLES = [
  "default", "pointer", "text", "wait", "progress", "move", "grab", "grabbing",
  "not-allowed", "no-drop", "help", "crosshair", "context-menu", "copy", "alias",
  "cell", "vertical-text", "all-scroll", "col-resize", "row-resize", "n-resize",
  "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize",
  "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize",
  "zoom-in", "zoom-out",
] as const;

export type CursorRole = (typeof CURSOR_ROLES)[number];

export const CURSOR_ROLE_OPTIONS: ReadonlyArray<{ value: CursorRole; label: string }> = [
  { value: "default", label: "一般指標（Default）" },
  { value: "pointer", label: "連結／可點擊（Pointer）" },
  { value: "text", label: "文字輸入（Text）" },
  { value: "wait", label: "等待（Wait）" },
  { value: "progress", label: "背景作業／載入（Progress）" },
  { value: "move", label: "移動物件（Move）" },
  { value: "grab", label: "可抓取（Grab）" },
  { value: "grabbing", label: "抓取中（Grabbing）" },
  { value: "not-allowed", label: "禁止操作（Not allowed）" },
  { value: "no-drop", label: "不可放置（No drop）" },
  { value: "help", label: "說明（Help）" },
  { value: "crosshair", label: "精準選取（Crosshair）" },
  { value: "context-menu", label: "快捷選單（Context menu）" },
  { value: "copy", label: "複製（Copy）" },
  { value: "alias", label: "建立捷徑（Alias）" },
  { value: "cell", label: "儲存格（Cell）" },
  { value: "vertical-text", label: "垂直文字（Vertical text）" },
  { value: "all-scroll", label: "全方向捲動（All scroll）" },
  { value: "col-resize", label: "欄寬調整（Col resize）" },
  { value: "row-resize", label: "列高調整（Row resize）" },
  { value: "n-resize", label: "向上調整（N resize）" },
  { value: "e-resize", label: "向右調整（E resize）" },
  { value: "s-resize", label: "向下調整（S resize）" },
  { value: "w-resize", label: "向左調整（W resize）" },
  { value: "ne-resize", label: "右上調整（NE resize）" },
  { value: "nw-resize", label: "左上調整（NW resize）" },
  { value: "se-resize", label: "右下調整（SE resize）" },
  { value: "sw-resize", label: "左下調整（SW resize）" },
  { value: "ew-resize", label: "水平調整（EW resize）" },
  { value: "ns-resize", label: "垂直調整（NS resize）" },
  { value: "nesw-resize", label: "右上／左下斜向調整" },
  { value: "nwse-resize", label: "左上／右下斜向調整" },
  { value: "zoom-in", label: "放大（Zoom in）" },
  { value: "zoom-out", label: "縮小（Zoom out）" },
];

export interface CursorPreferences {
  mode: CursorMode;
  size: number;
  hotspotX: number;
  hotspotY: number;
  preserveTextCursor: boolean;
}

export interface CursorAssetRecord {
  id: "custom-cursor";
  filename: string;
  blob: Blob;
  kind: CursorFileKind;
  updatedAt: string;
}

export interface CursorThemeAsset {
  filename: string;
  blob: Blob;
  kind: CursorFileKind;
  updatedAt: string;
}

export type CursorThemeInput = Partial<Record<
  CursorRole,
  { filename: string; blob: Blob; kind: CursorFileKind; updatedAt?: string }
>>;

export interface CursorThemeRecord {
  id: "custom-cursor-theme";
  cursors: Partial<Record<CursorRole, CursorThemeAsset>>;
  updatedAt: string;
}

export interface AniFrame {
  image: Blob;
  delayMs: number;
}

export const CURSOR_CHANGED_EVENT = "obsidian-cursor-changed";
export const MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const MAX_CURSOR_ZIP_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_CURSOR_EXTENSIONS = [
  ".cur", ".ani", ".ico", ".png", ".apng", ".gif", ".webp", ".jpg", ".jpeg",
];

const CURSOR_STORAGE_KEY = "web-obsidian-cursor-v1";
const CURSOR_ID = "custom-cursor" as const;
const CURSOR_THEME_ID = "custom-cursor-theme" as const;
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

const MODES: CursorMode[] = ["system", "custom"];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function readCursorPreferences(): CursorPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_CURSOR_PREFERENCES };
  try {
    const value = JSON.parse(localStorage.getItem(CURSOR_STORAGE_KEY) || "null") as Partial<CursorPreferences> | null;
    if (!value || typeof value !== "object") return { ...DEFAULT_CURSOR_PREFERENCES };
    return {
      mode: MODES.includes(value.mode as CursorMode) ? value.mode as CursorMode : "system",
      size: clamp(value.size, 16, 96, DEFAULT_CURSOR_PREFERENCES.size),
      hotspotX: clamp(value.hotspotX, 0, 100, 0),
      hotspotY: clamp(value.hotspotY, 0, 100, 0),
      preserveTextCursor: typeof value.preserveTextCursor === "boolean" ? value.preserveTextCursor : true,
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
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CURSOR_CHANGED_EVENT));
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

function readRecord<T>(id: string): Promise<T | null> {
  return openCursorDB().then((db) => new Promise<T | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as T | undefined) || null);
    request.onerror = () => reject(request.error || new Error("讀取游標資料失敗"));
  }));
}

/** 舊版單一游標記錄，保留以便相容與遷移。 */
export async function getSavedCursor(): Promise<CursorAssetRecord | null> {
  return readRecord<CursorAssetRecord>(CURSOR_ID);
}

/** 讀取完整主題；若只有舊版單一游標，會將它當作 default 狀態。 */
export async function getSavedCursorTheme(): Promise<CursorThemeRecord | null> {
  const theme = await readRecord<CursorThemeRecord>(CURSOR_THEME_ID);
  if (theme?.cursors && Object.keys(theme.cursors).length) return theme;

  const legacy = await getSavedCursor();
  if (!legacy) return null;
  return {
    id: CURSOR_THEME_ID,
    cursors: {
      default: {
        filename: legacy.filename,
        blob: legacy.blob,
        kind: legacy.kind,
        updatedAt: legacy.updatedAt,
      },
    },
    updatedAt: legacy.updatedAt,
  };
}

/** 整份主題以單一 IndexedDB 記錄儲存；新主題不會留下被取代的舊檔。 */
export async function replaceSavedCursorTheme(cursors: CursorThemeInput): Promise<void> {
  const entries = Object.entries(cursors) as Array<[CursorRole, CursorThemeInput[CursorRole]]>;
  const next: Partial<Record<CursorRole, CursorThemeAsset>> = {};
  for (const [role, entry] of entries) {
    if (!entry) continue;
    if (!CURSOR_ROLES.includes(role)) continue;
    if (!entry.blob || entry.blob.size <= 0 || entry.blob.size > MAX_CURSOR_BYTES) {
      throw new Error(`「${entry.filename || role}」必須小於 8 MB，且不能為空白`);
    }
    next[role] = {
      filename: entry.filename,
      blob: entry.blob,
      kind: entry.kind,
      updatedAt: new Date().toISOString(),
    };
  }
  if (!Object.keys(next).length) throw new Error("請至少指定一個游標狀態");

  const db = await openCursorDB();
  const record: CursorThemeRecord = {
    id: CURSOR_THEME_ID,
    cursors: next,
    updatedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(record);
    store.delete(CURSOR_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("儲存游標主題失敗"));
    transaction.onabort = () => reject(transaction.error || new Error("儲存游標主題已取消"));
  });
  notifyCursorChanged();
}

/** 相容舊呼叫：單一游標會成為主題的 default 狀態。 */
export async function replaceSavedCursor(file: File, kind: CursorFileKind): Promise<void> {
  await replaceSavedCursorTheme({
    default: { filename: file.name, blob: file, kind },
  });
}

export async function deleteSavedCursor(): Promise<void> {
  const db = await openCursorDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(CURSOR_ID);
    store.delete(CURSOR_THEME_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("刪除游標主題失敗"));
    transaction.onabort = () => reject(transaction.error || new Error("刪除游標主題已取消"));
  });
  notifyCursorChanged();
}

export function cursorBytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return copied.buffer as ArrayBuffer;
}

const readU32 = (view: DataView, offset: number): number => view.getUint32(offset, true);
const fourcc = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/** 讀取 Windows ANI (RIFF ACON) 中的 CUR/ICO 影格與每格延遲。 */
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

  function walk(start: number, end: number, depth: number): void {
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
  if (!cursorIconFlag) {
    throw new Error("這個 ANI 使用非標準 DIB 影格，暫時不支援，請轉成 GIF 或 APNG 再匯入");
  }

  const count = Math.min(headerSteps || sequence.length || frames.length, 512);
  const result: AniFrame[] = [];
  for (let step = 0; step < count; step++) {
    const index = sequence.length ? sequence[step % sequence.length] : step % frames.length;
    const raw = frames[index];
    if (!raw) throw new Error(`ANI 引用了不存在的影格 ${index}`);
    const normalized = normalizeIconBytes(raw);
    const ticks = rates[step] || defaultRate;
    const delayMs = Math.max(20, Math.min(2500, Math.round(ticks * 1000 / 60)));
    result.push({
      image: new Blob([cursorBytesToBuffer(normalized)], { type: "image/x-icon" }),
      delayMs,
    });
  }
  return result;
}

/** 將 CUR 的目錄轉為可供瀏覽器解碼的 ICO 目錄。 */
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

/** 依常見 Windows 游標檔名猜測 CSS 游標用途；不確定時回傳空字串供手動指定。 */
export function guessCursorRole(filename: string): CursorRole | "" {
  const base = filename.split(/[\\/]/).pop() || filename;
  const normalized = base
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/^(?:aero|windows|classic|cursor)[_-]?/, "")
    .replace(/[^a-z0-9]/g, "");

  if (/^(appstarting|working|progress|backgroundwork)$/.test(normalized)) return "progress";
  if (/^(wait|busy|loading|hourglass)$/.test(normalized)) return "wait";
  if (/^(ibeam|text|beam|textselect)$/.test(normalized)) return "text";
  if (/^(sizeall|move|moveall)$/.test(normalized)) return "move";
  if (/^(sizenesw|nesw|diagonalnesw)$/.test(normalized)) return "nesw-resize";
  if (/^(sizenwse|nwse|diagonalnwse)$/.test(normalized)) return "nwse-resize";
  if (/^(sizens|ns|verticalresize)$/.test(normalized)) return "ns-resize";
  if (/^(sizewe|ew|horizontalresize)$/.test(normalized)) return "ew-resize";
  if (/^(no|unavail|unavailable|notallowed|forbidden|blocked)$/.test(normalized)) return "not-allowed";
  if (/^(cross|crosshair|precision)$/.test(normalized)) return "crosshair";
  if (/^(help|helpsel|question)$/.test(normalized)) return "help";
  if (/^(hand|alink|link|pointer)$/.test(normalized)) return "pointer";
  if (/^(arrow|default|normal)$/.test(normalized)) return "default";
  if (/^grab$/.test(normalized)) return "grab";
  if (/^grabbing$/.test(normalized)) return "grabbing";
  if (/^nodrop$/.test(normalized)) return "no-drop";
  if (/^contextmenu$/.test(normalized)) return "context-menu";
  if (/^copy$/.test(normalized)) return "copy";
  if (/^alias$/.test(normalized)) return "alias";
  if (/^cell$/.test(normalized)) return "cell";
  if (/^verticaltext$/.test(normalized)) return "vertical-text";
  if (/^allscroll$/.test(normalized)) return "all-scroll";
  if (/^colresize$/.test(normalized)) return "col-resize";
  if (/^rowresize$/.test(normalized)) return "row-resize";
  if (/^nresize$/.test(normalized)) return "n-resize";
  if (/^eresize$/.test(normalized)) return "e-resize";
  if (/^sresize$/.test(normalized)) return "s-resize";
  if (/^wresize$/.test(normalized)) return "w-resize";
  if (/^neresize$/.test(normalized)) return "ne-resize";
  if (/^nwresize$/.test(normalized)) return "nw-resize";
  if (/^seresize$/.test(normalized)) return "se-resize";
  if (/^swresize$/.test(normalized)) return "sw-resize";
  if (/^zoomin$/.test(normalized)) return "zoom-in";
  if (/^zoomout$/.test(normalized)) return "zoom-out";
  return "";
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
    if (!header.slice(0, 8).every((value, index) =>
      value === [137, 80, 78, 71, 13, 10, 26, 10][index]
    )) throw new Error("PNG 檔案標頭無效");
    const array = new Uint8Array(await file.arrayBuffer());
    let offset = 8;
    while (offset + 12 <= array.length) {
      const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      const size = view.getUint32(offset, false);
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
