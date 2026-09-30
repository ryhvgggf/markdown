import { extractOutlinks, extractTags } from "./parser";
import { MediaAttachment, Note, NoteMetadata } from "./types";

const DB_NAME = "WebObsidianDB";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

export function extractNoteMetadata(note: Note): NoteMetadata {
  const content = note.content || "";
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const summary = content
    .replace(/[#*`_~[\]()]/g, "")
    .slice(0, 100)
    .replace(/\n+/g, " ")
    .trim();

  return {
    id: note.id,
    title: note.title,
    folder: note.folder,
    tags: note.tags || extractTags(content),
    outlinks: note.outlinks || extractOutlinks(content),
    summary: summary || "無內容摘要",
    charCount: content.length,
    wordCount: words,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function openDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }

  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. 筆記內文表（儲存完整文字）
      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id" });
      }

      // 2. 元資料表（輕量索引，供清單、目錄樹與關聯圖譜快速查詢）
      if (!db.objectStoreNames.contains("metadata")) {
        const metaStore = db.createObjectStore("metadata", { keyPath: "id" });
        metaStore.createIndex("title", "title", { unique: false });
        metaStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // 3. 多媒體附件表（儲存圖片、影片二進位 Blob）
      if (!db.objectStoreNames.contains("media")) {
        const mediaStore = db.createObjectStore("media", { keyPath: "id" });
        mediaStore.createIndex("filename", "filename", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * 取得所有筆記之輕量元資料列表（按需延遲載入的核心）
 */
export async function getAllNoteMetadata(): Promise<NoteMetadata[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("metadata", "readonly");
    const store = tx.objectStore("metadata");
    const req = store.getAll();

    req.onsuccess = () => {
      const list: NoteMetadata[] = req.result || [];
      // 依更新時間倒序排序
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      resolve(list);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * 按需載入特定筆記之完整內容
 */
export async function getNoteContent(id: string): Promise<Note | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readonly");
    const store = tx.objectStore("notes");
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 儲存單篇筆記（同時更新 notes 與 metadata 表）
 */
export async function saveNoteToDB(note: Note): Promise<void> {
  const db = await openDB();
  const metadata = extractNoteMetadata(note);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite");
    const notesStore = tx.objectStore("notes");
    const metaStore = tx.objectStore("metadata");

    notesStore.put(note);
    metaStore.put(metadata);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 刪除指定筆記
 */
export async function deleteNoteFromDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite");
    tx.objectStore("notes").delete(id);
    tx.objectStore("metadata").delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 取得全部完整筆記（供完整 JSON 備份匯出）
 */
export async function getAllNotesFromDB(): Promise<Note[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readonly");
    const store = tx.objectStore("notes");
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 批次儲存筆記（供匯入還原或遷移）
 */
export async function batchSaveNotesToDB(notes: Note[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite");
    const notesStore = tx.objectStore("notes");
    const metaStore = tx.objectStore("metadata");

    notesStore.clear();
    metaStore.clear();

    for (const note of notes) {
      notesStore.put(note);
      metaStore.put(extractNoteMetadata(note));
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 二進位媒體附件存取 API
 */
export async function saveMediaAttachment(attachment: MediaAttachment): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").put(attachment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMediaAttachment(id: string): Promise<MediaAttachment | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readonly");
    const req = tx.objectStore("media").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMediaAttachment(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


export async function importVaultBackupToDB(notes: Note[]): Promise<void> {
  return batchSaveNotesToDB(notes);
}

const CUSTOM_FOLDERS_STORAGE_KEY = 'obsidian_custom_folders';

export function getCustomFolders(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomFolders(folders: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  } catch (e) {
    console.error('儲存資料夾列表失敗:', e);
  }
}
