import JSZip from "jszip";

import {
  batchSaveMediaAttachments,
  batchSaveNotesToDB,
  getAllMediaAttachments,
  getAllNoteMetadata,
  getAllNotesFromDB,
  getCustomFolders,
  getMediaAttachmentByReference,
  replaceAllMediaAttachments,
  saveCustomFolders,
  saveNoteToDB,
} from "./db";

import {
  extractMediaReferences,
  extractOutlinks,
  extractTags,
} from "./parser";

import {
  MediaAttachment,
  Note,
} from "./types";

const LEGACY_STORAGE_KEY = "web-obsidian-vault-v1";
const MIGRATION_FLAG_KEY = "web-obsidian-migrated-to-idb";

const ZIP_FORMAT = "markdown-vault-zip";
const ZIP_VERSION = 3;

type ZipPackageKind = "vault" | "notes";

interface ZipNoteEntry {
  id: string;
  title: string;
  folder?: string;
  tags: string[];
  outlinks: string[];
  createdAt: string;
  updatedAt: string;
  path: string;
}

interface ZipMediaEntry {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  path: string;
}

interface ZipManifest {
  format: typeof ZIP_FORMAT;
  version: typeof ZIP_VERSION;
  kind: ZipPackageKind;
  exportedAt: string;
  vaultName: string;
  customFolders: string[];
  notes: ZipNoteEntry[];
  media: ZipMediaEntry[];
}

interface LoadedZipPackage {
  manifest: ZipManifest;
  notes: Note[];
  media: MediaAttachment[];
}

export interface RestoreZipResult {
  notes: Note[];
  mediaCount: number;
  folderCount: number;
}

export interface ImportNotesZipResult {
  notes: Note[];
  mediaCount: number;
  folderCount: number;
  renamedCount: number;
}

export function getDefaultNotes(): Note[] {
  const now = new Date().toISOString();

  return [
    {
      id: "note-welcome",
      title: "歡迎來到 Markdown 知識庫 (高效能版)",
      content: `# 歡迎使用 Markdown 知識庫

本版本採用 **IndexedDB 本機資料庫架構**。

## 功能
- Markdown 編輯 / 預覽 / 雙欄
- [[雙向連結與知識網絡]]
- Tag
- Backlinks
- Graph View
- 圖片、影片與附件
- ZIP 完整備份 / 還原
- 單篇 / 選取筆記 ZIP 匯出
- ZIP 筆記追加匯入
`,
      tags: ["第二大腦", "知識管理"],
      outlinks: ["雙向連結與知識網絡"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "note-bi-links",
      title: "雙向連結與知識網絡",
      content: `# 雙向連結與知識網絡

雙向連結是知識庫的核心骨架。

## 如何使用雙向連結？
- 輸入 \`[[筆記名稱]]\`
- 支援 \`[[筆記名稱#章節]]\`
- 支援 \`[[筆記名稱|顯示別名]]\`

返回 [[歡迎來到 Markdown 知識庫 (高效能版)]]。
`,
      tags: ["筆記方法", "雙向連結"],
      outlinks: ["歡迎來到 Markdown 知識庫 (高效能版)"],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export async function initVaultStorage(): Promise<{
  migratedCount: number;
  isFirstInit: boolean;
}> {
  if (typeof window === "undefined") {
    return {
      migratedCount: 0,
      isFirstInit: false,
    };
  }

  const hasMigrated = window.localStorage.getItem(MIGRATION_FLAG_KEY);

  if (!hasMigrated) {
    try {
      const rawLegacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);

      if (rawLegacy) {
        const parsed = JSON.parse(rawLegacy);

        if (Array.isArray(parsed) && parsed.length > 0) {
          const notesToMigrate: Note[] = parsed.map((item: any) => {
            const content =
              typeof item?.content === "string" ? item.content : "";

            return {
              id:
                typeof item?.id === "string" && item.id
                  ? item.id
                  : createId("note"),
              title:
                typeof item?.title === "string" && item.title.trim()
                  ? item.title.trim()
                  : "未命名筆記",
              content,
              folder:
                typeof item?.folder === "string" ? item.folder : "",
              tags: extractTags(content),
              outlinks: extractOutlinks(content),
              createdAt:
                typeof item?.createdAt === "string"
                  ? item.createdAt
                  : new Date().toISOString(),
              updatedAt:
                typeof item?.updatedAt === "string"
                  ? item.updatedAt
                  : new Date().toISOString(),
            };
          });

          await batchSaveNotesToDB(notesToMigrate);

          window.localStorage.setItem(MIGRATION_FLAG_KEY, "true");
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);

          return {
            migratedCount: notesToMigrate.length,
            isFirstInit: false,
          };
        }
      }
    } catch (error) {
      console.warn("自 LocalStorage 遷移資料失敗:", error);
    }

    window.localStorage.setItem(MIGRATION_FLAG_KEY, "true");
  }

  const existingMeta = await getAllNoteMetadata();

  if (existingMeta.length === 0) {
    await batchSaveNotesToDB(getDefaultNotes());

    return {
      migratedCount: 0,
      isFirstInit: true,
    };
  }

  return {
    migratedCount: 0,
    isFirstInit: false,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "untitled";
}

function sanitizePathSegment(value: string): string {
  return sanitizeFilename(value)
    .replace(/\.\.+/g, "_")
    .replace(/^\.+$/, "_");
}

function getExtension(filename: string): string {
  const match = filename.match(/(\.[a-zA-Z0-9]{1,10})$/);
  return match ? match[1] : "";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function addFolderAndParents(target: Set<string>, folder?: string): void {
  const normalized = normalizeFolderPath(folder || "");

  if (!normalized) {
    return;
  }

  const parts = normalized.split("/");

  for (let index = 1; index <= parts.length; index++) {
    target.add(parts.slice(0, index).join("/"));
  }
}

function getRelevantFolders(notes: Note[]): string[] {
  const folders = new Set<string>();

  for (const note of notes) {
    addFolderAndParents(folders, note.folder);
  }

  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

async function collectReferencedMedia(
  notes: Note[]
): Promise<MediaAttachment[]> {
  const byId = new Map<string, MediaAttachment>();

  for (const note of notes) {
    const refs = extractMediaReferences(note.content);

    for (const ref of refs) {
      try {
        const media = await getMediaAttachmentByReference(ref);

        if (media) {
          byId.set(media.id, media);
        }
      } catch (error) {
        console.warn("讀取附件失敗:", ref, error);
      }
    }
  }

  return Array.from(byId.values());
}

function buildMediaPath(media: MediaAttachment): string {
  const safeId = sanitizePathSegment(media.id);
  const safeName = sanitizeFilename(media.filename);

  return `media/${safeId}/${safeName}`;
}

function buildNotePath(note: Note): string {
  const safeId = sanitizePathSegment(note.id);
  return `notes/${safeId}.md`;
}

async function buildZipPackage(
  notes: Note[],
  media: MediaAttachment[],
  customFolders: string[],
  kind: ZipPackageKind,
  vaultName: string
): Promise<Blob> {
  const zip = new JSZip();

  const noteEntries: ZipNoteEntry[] = notes.map((note) => ({
    id: note.id,
    title: note.title,
    folder: note.folder || "",
    tags: note.tags || extractTags(note.content),
    outlinks: note.outlinks || extractOutlinks(note.content),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    path: buildNotePath(note),
  }));

  const mediaEntries: ZipMediaEntry[] = media.map((item) => ({
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    createdAt: item.createdAt,
    path: buildMediaPath(item),
  }));

  const manifest: ZipManifest = {
    format: ZIP_FORMAT,
    version: ZIP_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
    vaultName,
    customFolders,
    notes: noteEntries,
    media: mediaEntries,
  };

  zip.file(
    "manifest.json",
    JSON.stringify(manifest, null, 2),
    {
      compression: "DEFLATE",
      compressionOptions: {
        level: 6,
      },
    }
  );

  for (const note of notes) {
    zip.file(
      buildNotePath(note),
      note.content,
      {
        compression: "DEFLATE",
        compressionOptions: {
          level: 6,
        },
      }
    );
  }

  /**
   * 圖片 / 影片 / PDF 等多數本身已經是壓縮格式。
   * 直接 STORE 可避免不必要的重新壓縮 CPU，
   * 且檔案 bytes 原封不動，不影響畫質。
   */
  for (const item of media) {
    zip.file(
      buildMediaPath(item),
      item.blob,
      {
        binary: true,
        compression: "STORE",
      }
    );
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: {
      level: 6,
    },
    streamFiles: true,
  });
}

function assertZipManifest(value: unknown): ZipManifest {
  if (!value || typeof value !== "object") {
    throw new Error("ZIP 缺少有效的 manifest.json");
  }

  const manifest = value as Partial<ZipManifest>;

  if (manifest.format !== ZIP_FORMAT) {
    throw new Error("不是 Markdown 知識庫 ZIP 檔");
  }

  if (manifest.version !== ZIP_VERSION) {
    throw new Error(
      `不支援此 ZIP 版本：${String(manifest.version ?? "")}`
    );
  }

  if (manifest.kind !== "vault" && manifest.kind !== "notes") {
    throw new Error("ZIP 類型無效");
  }

  if (!Array.isArray(manifest.notes)) {
    throw new Error("ZIP manifest 缺少 notes");
  }

  if (!Array.isArray(manifest.media)) {
    throw new Error("ZIP manifest 缺少 media");
  }

  return manifest as ZipManifest;
}

async function loadZipPackage(file: Blob): Promise<LoadedZipPackage> {
  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("無法讀取 ZIP 檔");
  }

  const manifestFile = zip.file("manifest.json");

  if (!manifestFile) {
    throw new Error("ZIP 中找不到 manifest.json");
  }

  let manifestRaw: unknown;

  try {
    manifestRaw = JSON.parse(await manifestFile.async("string"));
  } catch {
    throw new Error("manifest.json 格式錯誤");
  }

  const manifest = assertZipManifest(manifestRaw);
  const notes: Note[] = [];

  for (const entry of manifest.notes) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.path !== "string"
    ) {
      throw new Error("ZIP 中有無效的筆記資訊");
    }

    const noteFile = zip.file(entry.path);

    if (!noteFile) {
      throw new Error(`ZIP 缺少筆記檔：${entry.title}`);
    }

    const content = await noteFile.async("string");

    notes.push({
      id: entry.id,
      title: entry.title,
      folder:
        typeof entry.folder === "string"
          ? entry.folder
          : "",
      content,
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      createdAt:
        typeof entry.createdAt === "string"
          ? entry.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof entry.updatedAt === "string"
          ? entry.updatedAt
          : new Date().toISOString(),
    });
  }

  const media: MediaAttachment[] = [];

  for (const entry of manifest.media) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.path !== "string"
    ) {
      continue;
    }

    const mediaFile = zip.file(entry.path);

    if (!mediaFile) {
      console.warn("ZIP 缺少附件:", entry.filename || entry.id);
      continue;
    }

    try {
      const buffer = await mediaFile.async("arraybuffer");
      const mimeType =
        typeof entry.mimeType === "string" && entry.mimeType
          ? entry.mimeType
          : "application/octet-stream";

      const blob = new Blob([buffer], {
        type: mimeType,
      });

      media.push({
        id: entry.id,
        filename:
          typeof entry.filename === "string" && entry.filename
            ? entry.filename
            : `attachment${getExtension(entry.path)}`,
        mimeType,
        blob,
        size:
          typeof entry.size === "number"
            ? entry.size
            : blob.size,
        createdAt:
          typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date().toISOString(),
      });
    } catch (error) {
      console.warn("附件解壓失敗:", entry.filename, error);
    }
  }

  return {
    manifest,
    notes,
    media,
  };
}

/* ============================================================
   ZIP Export
   ============================================================ */

export async function exportVaultZip(
  vaultName: string = "Markdown-Vault"
): Promise<void> {
  const notes = await getAllNotesFromDB();
  const media = await getAllMediaAttachments();
  const customFolders = getCustomFolders();

  const blob = await buildZipPackage(
    notes,
    media,
    customFolders,
    "vault",
    vaultName
  );

  downloadBlob(
    blob,
    `${sanitizeFilename(vaultName)}-${getDateStamp()}.zip`
  );
}

export async function exportNoteZip(note: Note): Promise<void> {
  const media = await collectReferencedMedia([note]);
  const folders = getRelevantFolders([note]);

  const blob = await buildZipPackage(
    [note],
    media,
    folders,
    "notes",
    note.title
  );

  downloadBlob(
    blob,
    `${sanitizeFilename(note.title)}.zip`
  );
}

export async function exportSelectedNotesZip(
  noteIds: string[],
  exportName: string = "Selected-Notes"
): Promise<void> {
  const uniqueIds = Array.from(new Set(noteIds.filter(Boolean)));

  if (uniqueIds.length === 0) {
    throw new Error("請至少選取一篇筆記");
  }

  const allNotes = await getAllNotesFromDB();
  const idSet = new Set(uniqueIds);
  const selectedNotes = allNotes.filter((note) => idSet.has(note.id));

  if (selectedNotes.length === 0) {
    throw new Error("找不到選取的筆記");
  }

  const media = await collectReferencedMedia(selectedNotes);
  const folders = getRelevantFolders(selectedNotes);

  const blob = await buildZipPackage(
    selectedNotes,
    media,
    folders,
    "notes",
    exportName
  );

  downloadBlob(
    blob,
    `${sanitizeFilename(exportName)}-${getDateStamp()}.zip`
  );
}

/* ============================================================
   ZIP Full Restore
   完整取代目前 Vault
   ============================================================ */

export async function restoreVaultZip(
  file: File | Blob
): Promise<RestoreZipResult> {
  const loaded = await loadZipPackage(file);

  if (loaded.manifest.kind !== "vault") {
    throw new Error(
      "這不是完整備份 ZIP。若要加入部分筆記，請使用「匯入筆記」。"
    );
  }

  if (loaded.notes.length === 0) {
    throw new Error("完整備份中沒有筆記");
  }

  await batchSaveNotesToDB(loaded.notes);
  await replaceAllMediaAttachments(loaded.media);

  const folders = Array.isArray(loaded.manifest.customFolders)
    ? loaded.manifest.customFolders
        .filter((item): item is string => typeof item === "string")
        .map(normalizeFolderPath)
        .filter(Boolean)
    : [];

  saveCustomFolders(folders);

  return {
    notes: loaded.notes,
    mediaCount: loaded.media.length,
    folderCount: folders.length,
  };
}

/* ============================================================
   ZIP Additive Import
   不覆蓋目前 Vault
   ============================================================ */

function makeUniqueTitle(
  wantedTitle: string,
  occupiedLowercase: Set<string>
): string {
  const clean = wantedTitle.trim() || "未命名筆記";

  if (!occupiedLowercase.has(clean.toLowerCase())) {
    occupiedLowercase.add(clean.toLowerCase());
    return clean;
  }

  let counter = 2;

  while (counter < 10000) {
    const candidate = `${clean} (匯入 ${counter})`;

    if (!occupiedLowercase.has(candidate.toLowerCase())) {
      occupiedLowercase.add(candidate.toLowerCase());
      return candidate;
    }

    counter += 1;
  }

  const fallback = `${clean} (匯入 ${Date.now()})`;
  occupiedLowercase.add(fallback.toLowerCase());

  return fallback;
}

function rewriteImportedNoteTitles(
  content: string,
  titleMap: Map<string, string>
): string {
  let result = content;

  for (const [oldTitle, newTitle] of titleMap.entries()) {
    if (oldTitle === newTitle) {
      continue;
    }

    const pattern = new RegExp(
      `\\[\\[${escapeRegExp(oldTitle)}((?:#[^|\\]]+)?(?:\\|[^\\]]+)?)\\]\\]`,
      "gi"
    );

    result = result.replace(
      pattern,
      (_match, suffix) =>
        `[[${newTitle}${suffix || ""}]]`
    );
  }

  return result;
}

function rewriteImportedMediaIds(
  content: string,
  mediaIdMap: Map<string, string>,
  filenameMap: Map<string, string>
): string {
  let result = content;

  for (const [oldId, newId] of mediaIdMap.entries()) {
    const pattern = new RegExp(
      `(!?\\[\\[)${escapeRegExp(oldId)}(?=(?:\\||\\]\\]))`,
      "g"
    );

    result = result.replace(
      pattern,
      `$1${newId}`
    );
  }

  /**
   * 舊版筆記可能使用 ![[filename.png]]
   * 若 filename 在匯入包中唯一，順便轉為新 media id。
   */
  for (const [filename, newId] of filenameMap.entries()) {
    const pattern = new RegExp(
      `!\\[\\[${escapeRegExp(filename)}(?:\\|([^\\]]+))?\\]\\]`,
      "g"
    );

    result = result.replace(
      pattern,
      (_match, alias) =>
        `![[${newId}|${alias || filename}]]`
    );
  }

  return result;
}

export async function importNotesZip(
  file: File | Blob
): Promise<ImportNotesZipResult> {
  const loaded = await loadZipPackage(file);

  if (loaded.notes.length === 0) {
    throw new Error("ZIP 中沒有可匯入的筆記");
  }

  const existingNotes = await getAllNotesFromDB();

  const occupiedTitles = new Set(
    existingNotes.map((note) => note.title.trim().toLowerCase())
  );

  const titleMap = new Map<string, string>();
  let renamedCount = 0;

  for (const sourceNote of loaded.notes) {
    const nextTitle = makeUniqueTitle(
      sourceNote.title,
      occupiedTitles
    );

    titleMap.set(sourceNote.title, nextTitle);

    if (nextTitle !== sourceNote.title) {
      renamedCount += 1;
    }
  }

  const mediaIdMap = new Map<string, string>();
  const filenameCounts = new Map<string, number>();

  for (const sourceMedia of loaded.media) {
    mediaIdMap.set(
      sourceMedia.id,
      createId("media")
    );

    filenameCounts.set(
      sourceMedia.filename,
      (filenameCounts.get(sourceMedia.filename) || 0) + 1
    );
  }

  const uniqueFilenameMap = new Map<string, string>();

  for (const sourceMedia of loaded.media) {
    if (filenameCounts.get(sourceMedia.filename) === 1) {
      const mappedId = mediaIdMap.get(sourceMedia.id);

      if (mappedId) {
        uniqueFilenameMap.set(sourceMedia.filename, mappedId);
      }
    }
  }

  const importedMedia: MediaAttachment[] = loaded.media.map(
    (sourceMedia) => ({
      ...sourceMedia,
      id:
        mediaIdMap.get(sourceMedia.id) ||
        createId("media"),
      blob: sourceMedia.blob,
    })
  );

  const importedNotes: Note[] = loaded.notes.map((sourceNote) => {
    const renamedTitle =
      titleMap.get(sourceNote.title) || sourceNote.title;

    let content = rewriteImportedNoteTitles(
      sourceNote.content,
      titleMap
    );

    content = rewriteImportedMediaIds(
      content,
      mediaIdMap,
      uniqueFilenameMap
    );

    return {
      ...sourceNote,
      id: createId("note"),
      title: renamedTitle,
      content,
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      createdAt: sourceNote.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  /**
   * 先寫入媒體，再寫入筆記。
   * 因為所有 media / note ID 都重新產生，所以不會覆蓋現有資料。
   */
  await batchSaveMediaAttachments(importedMedia);

  for (const note of importedNotes) {
    await saveNoteToDB(note);
  }

  const folderSet = new Set(
    getCustomFolders()
      .map(normalizeFolderPath)
      .filter(Boolean)
  );

  for (const folder of loaded.manifest.customFolders || []) {
    addFolderAndParents(folderSet, folder);
  }

  for (const note of importedNotes) {
    addFolderAndParents(folderSet, note.folder);
  }

  const mergedFolders = Array.from(folderSet).sort((a, b) =>
    a.localeCompare(b)
  );

  saveCustomFolders(mergedFolders);

  return {
    notes: importedNotes,
    mediaCount: importedMedia.length,
    folderCount: mergedFolders.length,
    renamedCount,
  };
}

/* ============================================================
   Backward-compatible function names
   ------------------------------------------------------------
   舊 UI 若仍暫時呼叫舊名稱：
   exportVaultJson / exportNoteMarkdown
   也會輸出 ZIP，不再輸出 JSON / 單純 MD。
   ============================================================ */

export async function exportVaultJson(
  vaultName: string = "Markdown-Vault"
): Promise<void> {
  return exportVaultZip(vaultName);
}

export async function exportNoteMarkdown(
  note: Note
): Promise<void> {
  return exportNoteZip(note);
}

/* ============================================================
   Legacy JSON Restore Compatibility
   ------------------------------------------------------------
   只保留「讀取舊 JSON 備份」能力，
   新版所有匯出一律 ZIP。
   ============================================================ */

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("DataURL 轉換 Blob 失敗");
  }

  return response.blob();
}

export async function parseAndRestoreVaultBackup(
  jsonStr: string
): Promise<RestoreZipResult> {
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      "舊版還原函式只接受 JSON；新版請使用 restoreVaultZip()"
    );
  }

  const notesArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.notes)
    ? parsed.notes
    : null;

  if (!notesArray) {
    throw new Error("備份檔缺少 notes 陣列");
  }

  if (notesArray.length === 0) {
    throw new Error("備份檔中沒有筆記");
  }

  const now = new Date().toISOString();
  const validNotes: Note[] = [];

  for (const item of notesArray) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const title =
      typeof item.title === "string"
        ? item.title.trim()
        : "";

    if (!title) {
      continue;
    }

    const content =
      typeof item.content === "string"
        ? item.content
        : "";

    validNotes.push({
      id:
        typeof item.id === "string" && item.id
          ? item.id
          : createId("note"),
      title,
      content,
      folder:
        typeof item.folder === "string"
          ? item.folder
          : "",
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      createdAt:
        typeof item.createdAt === "string"
          ? item.createdAt
          : now,
      updatedAt:
        typeof item.updatedAt === "string"
          ? item.updatedAt
          : now,
    });
  }

  if (validNotes.length === 0) {
    throw new Error("沒有可還原的有效筆記");
  }

  const folders = Array.isArray(parsed?.customFolders)
    ? parsed.customFolders.filter(
        (item: unknown): item is string =>
          typeof item === "string"
      )
    : [];

  const restoredMedia: MediaAttachment[] = [];

  if (Array.isArray(parsed?.media)) {
    for (const item of parsed.media) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (
        typeof item.id !== "string" ||
        typeof item.dataUrl !== "string"
      ) {
        continue;
      }

      try {
        const blob = await dataUrlToBlob(item.dataUrl);

        restoredMedia.push({
          id: item.id,
          filename:
            typeof item.filename === "string"
              ? item.filename
              : "attachment",
          mimeType:
            typeof item.mimeType === "string"
              ? item.mimeType
              : blob.type || "application/octet-stream",
          blob,
          size:
            typeof item.size === "number"
              ? item.size
              : blob.size,
          createdAt:
            typeof item.createdAt === "string"
              ? item.createdAt
              : now,
        });
      } catch (error) {
        console.warn("附件還原失敗:", item?.filename, error);
      }
    }
  }

  await batchSaveNotesToDB(validNotes);
  await replaceAllMediaAttachments(restoredMedia);
  saveCustomFolders(folders);

  return {
    notes: validNotes,
    mediaCount: restoredMedia.length,
    folderCount: folders.length,
  };
}

export function validateAndParseVaultBackup(
  jsonStr: string
): Note[] {
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("檔案不是合法 JSON");
  }

  const notesArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.notes)
    ? parsed.notes
    : [];

  return notesArray.filter(
    (note: any) =>
      note &&
      typeof note === "object" &&
      typeof note.title === "string" &&
      note.title.trim()
  );
}

