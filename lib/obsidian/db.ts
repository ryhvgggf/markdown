import { extractOutlinks, extractTags } from "./parser";
import { MediaAttachment, Note, NoteMetadata } from "./types";

const DB_NAME = "WebObsidianDB";
const DB_VERSION = 1;
const CUSTOM_FOLDERS_STORAGE_KEY = "obsidian_custom_folders";

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

      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("metadata")) {
        const metaStore = db.createObjectStore("metadata", { keyPath: "id" });
        metaStore.createIndex("title", "title", { unique: false });
        metaStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("media")) {
        const mediaStore = db.createObjectStore("media", { keyPath: "id" });
        mediaStore.createIndex("filename", "filename", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function getAllNoteMetadata(): Promise<NoteMetadata[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("metadata", "readonly");
    const req = tx.objectStore("metadata").getAll();

    req.onsuccess = () => {
      const list: NoteMetadata[] = req.result || [];
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      resolve(list);
    };

    req.onerror = () => reject(req.error);
  });
}

export async function getNoteContent(id: string): Promise<Note | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readonly");
    const req = tx.objectStore("notes").get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveNoteToDB(note: Note): Promise<void> {
  const db = await openDB();
  const metadata = extractNoteMetadata(note);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite");

    tx.objectStore("notes").put(note);
    tx.objectStore("metadata").put(metadata);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteNoteFromDB(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite");

    tx.objectStore("notes").delete(id);
    tx.objectStore("metadata").delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAllNotesFromDB(): Promise<Note[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readonly");
    const req = tx.objectStore("notes").getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

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
    tx.onabort = () => reject(tx.error);
  });
}

/* ============================================================
   Media
   ============================================================ */

export async function saveMediaAttachment(
  attachment: MediaAttachment
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").put(attachment);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMediaAttachment(
  id: string
): Promise<MediaAttachment | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readonly");
    const req = tx.objectStore("media").get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 舊版 ![[filename.ext]] 相容：
 * 先以 ID 查詢，找不到時再以 filename index 查詢。
 */
export async function getMediaAttachmentByReference(
  ref: string
): Promise<MediaAttachment | null> {
  const byId = await getMediaAttachment(ref);
  if (byId) return byId;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readonly");
    const store = tx.objectStore("media");

    if (!store.indexNames.contains("filename")) {
      resolve(null);
      return;
    }

    const req = store.index("filename").get(ref);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllMediaAttachments(): Promise<MediaAttachment[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readonly");
    const req = tx.objectStore("media").getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function batchSaveMediaAttachments(
  attachments: MediaAttachment[]
): Promise<void> {
  if (attachments.length === 0) return;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    const store = tx.objectStore("media");

    for (const item of attachments) {
      store.put(item);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * 完整還原時使用：
 * 先清掉舊媒體，再寫入備份內媒體，避免 orphan media 殘留。
 */
export async function replaceAllMediaAttachments(
  attachments: MediaAttachment[]
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    const store = tx.objectStore("media");

    store.clear();

    for (const item of attachments) {
      store.put(item);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteMediaAttachment(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ============================================================
   Backward-compatible API
   ============================================================ */

export async function importVaultBackupToDB(notes: Note[]): Promise<void> {
  return batchSaveNotesToDB(notes);
}

/* ============================================================
   Custom folders
   ============================================================ */

export function getCustomFolders(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveCustomFolders(folders: string[]): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      CUSTOM_FOLDERS_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(folders)))
    );
  } catch (e) {
    console.error("儲存資料夾列表失敗:", e);
  }
}
