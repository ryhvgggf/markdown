import {
  batchSaveNotesToDB,
  getAllMediaAttachments,
  getAllNoteMetadata,
  getAllNotesFromDB,
  getCustomFolders,
  replaceAllMediaAttachments,
  saveCustomFolders,
} from "./db";
import { extractOutlinks, extractTags } from "./parser";
import {
  MediaAttachment,
  Note,
  SerializedMediaAttachment,
  VaultBackup,
} from "./types";

const LEGACY_STORAGE_KEY = "web-obsidian-vault-v1";
const MIGRATION_FLAG_KEY = "web-obsidian-migrated-to-idb";

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
- JSON 完整備份 / 還原
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
                  : `note-${Date.now()}-${Math.random()
                      .toString(36)
                      .slice(2, 8)}`,
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("DataURL 轉換 Blob 失敗");
  }

  return response.blob();
}

export async function exportVaultJson(
  vaultName: string = "Markdown-Vault"
): Promise<void> {
  const notes = await getAllNotesFromDB();
  const mediaList = await getAllMediaAttachments();
  const customFolders = getCustomFolders();

  const serializedMedia: SerializedMediaAttachment[] = [];

  for (const media of mediaList) {
    try {
      const dataUrl = await blobToDataUrl(media.blob);

      serializedMedia.push({
        id: media.id,
        filename: media.filename,
        mimeType: media.mimeType,
        size: media.size,
        dataUrl,
        createdAt: media.createdAt,
      });
    } catch (error) {
      console.warn("備份附件失敗:", media.filename, error);
    }
  }

  const backup: VaultBackup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    vaultName,
    notes,
    customFolders,
    media: serializedMedia,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${vaultName}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export function exportNoteMarkdown(note: Note): void {
  const blob = new Blob([note.content], {
    type: "text/markdown;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${note.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export async function parseAndRestoreVaultBackup(
  jsonStr: string
): Promise<{
  notes: Note[];
  mediaCount: number;
  folderCount: number;
}> {
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
    if (!item || typeof item !== "object") continue;

    const title =
      typeof item.title === "string" ? item.title.trim() : "";

    if (!title) continue;

    const content =
      typeof item.content === "string" ? item.content : "";

    validNotes.push({
      id:
        typeof item.id === "string" && item.id
          ? item.id
          : `note-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
      title,
      content,
      folder:
        typeof item.folder === "string" ? item.folder : "",
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
        (item: unknown): item is string => typeof item === "string"
      )
    : [];

  const restoredMedia: MediaAttachment[] = [];

  if (Array.isArray(parsed?.media)) {
    for (const item of parsed.media) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.id !== "string" || typeof item.dataUrl !== "string") {
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
            typeof item.size === "number" ? item.size : blob.size,
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

  /**
   * 完整還原語意：
   * notes / folders / media 全部以備份檔為準。
   */
  await batchSaveNotesToDB(validNotes);
  await replaceAllMediaAttachments(restoredMedia);
  saveCustomFolders(folders);

  return {
    notes: validNotes,
    mediaCount: restoredMedia.length,
    folderCount: folders.length,
  };
}

export function validateAndParseVaultBackup(jsonStr: string): Note[] {
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
