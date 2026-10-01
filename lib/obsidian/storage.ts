import {
  batchSaveNotesToDB,
  getAllNoteMetadata,
  getAllNotesFromDB,
  getAllMediaAttachments,
  batchSaveMediaAttachments,
  getCustomFolders,
  saveCustomFolders,
} from "./db";
import { extractOutlinks, extractTags } from "./parser";
import { Note, VaultBackup, MediaAttachment, SerializedMediaAttachment } from "./types";

const LEGACY_STORAGE_KEY = "web-obsidian-vault-v1";
const MIGRATION_FLAG_KEY = "web-obsidian-migrated-to-idb";

/**
 * 預設展示教學筆記
 */
export function getDefaultNotes(): Note[] {
  const now = new Date().toISOString();
  return [
    {
      id: "note-welcome",
      title: "歡迎來到 Markdown 知識庫 (高效能版)",
      content: `# 歡迎使用 Markdown 知識庫 👋

本版本已全面升級為 **IndexedDB 大容量本機資料庫架構**！

## 🚀 性能與多媒體支援升級
- 💾 **IndexedDB 本機永久儲存**：突破原本 LocalStorage 的 5MB 限制，可容納數百 MB 至數 GB 的筆記資料庫。
- ⚡ **元資料按需延遲載入（Lazy Loading）**：啟動時僅載入目錄索引，選取筆記時才載入內文，就算有數萬篇筆記也秒開不卡頓！
- 📜 **虛擬滾動清單（Virtual Scrolling）**：左側目錄樹固定只渲染視窗內的 DOM 節點，滾動永遠保持 60 FPS 流暢度。
- 🖼️ **圖片與影片多媒體支援**：可直接拖曳或剪貼簿貼上圖片與短影片，自動存入二進位媒體庫。
- 🕸️ **局部關聯圖譜（Local Graph）**：大筆記庫下自動切換聚焦當前筆記關聯，保護瀏覽器運算資源。

請點擊閱讀 [[雙向連結與知識網絡]] 探索第二大腦！
`,
      tags: ["第二大腦", "知識管理", "性能優化"],
      outlinks: ["雙向連結與知識網絡"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "note-bi-links",
      title: "雙向連結與知識網絡",
      content: `# 雙向連結與知識網絡 🧠

雙向連結（Bi-directional Linking）是第二大腦的核心骨架：

## 如何使用雙向連結？
- 輸入 \`[[筆記名稱]]\` 即可指向其他筆記，例如返回 [[歡迎來到 Markdown 知識庫 (高效能版)]]。
- 若筆記尚未建立，點擊即可一鍵建立新頁面！
- 支援別名：\`[[筆記名稱|顯示別名]]\`。

## 媒體附件展示
未來可在此筆記中貼入截圖或短影片，系統將以二進位 Blob 形式安全存在本機，隨時在預覽區即時播放。
`,
      tags: ["筆記方法", "雙向連結"],
      outlinks: ["歡迎來到 Markdown 知識庫 (高效能版)"],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * 初始化知識庫：
 * 1. 檢測並自動自 LocalStorage 遷移既有筆記至 IndexedDB
 * 2. 若為全新庫則寫入預設教學筆記
 */
export async function initVaultStorage(): Promise<{ migratedCount: number; isFirstInit: boolean }> {
  if (typeof window === "undefined") {
    return { migratedCount: 0, isFirstInit: false };
  }

  const hasMigrated = window.localStorage.getItem(MIGRATION_FLAG_KEY);
  if (!hasMigrated) {
    try {
      const rawLegacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (rawLegacy) {
        const parsed = JSON.parse(rawLegacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const notesToMigrate: Note[] = parsed.map((n) => ({
            ...n,
            outlinks: extractOutlinks(n.content || ""),
            tags: extractTags(n.content || ""),
          }));

          await batchSaveNotesToDB(notesToMigrate);
          window.localStorage.setItem(MIGRATION_FLAG_KEY, "true");
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          return { migratedCount: notesToMigrate.length, isFirstInit: false };
        }
      }
    } catch (e) {
      console.warn("自 LocalStorage 遷移資料時發生異常:", e);
    }
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "true");
  }

  const existingMeta = await getAllNoteMetadata();
  if (existingMeta.length === 0) {
    const defaults = getDefaultNotes();
    await batchSaveNotesToDB(defaults);
    return { migratedCount: 0, isFirstInit: true };
  }

  return { migratedCount: 0, isFirstInit: false };
}

/**
 * 將二進位 Blob 轉為 Base64 DataURL
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 將 Base64 DataURL 還原為原始二進位 Blob
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * 匯出完整無損 Vault 備份檔（包含所有筆記、巢狀資料夾、高清照片與影片）
 */
export async function exportVaultJson(vaultName: string = "Markdown-Vault"): Promise<void> {
  const notes = await getAllNotesFromDB();
  const mediaList = await getAllMediaAttachments();
  const customFolders = getCustomFolders();

  const serializedMedia: SerializedMediaAttachment[] = [];
  for (const m of mediaList) {
    if (m.blob) {
      try {
        const dataUrl = await blobToDataUrl(m.blob);
        serializedMedia.push({
          id: m.id,
          filename: m.filename,
          mimeType: m.mimeType,
          size: m.size,
          dataUrl,
          createdAt: m.createdAt,
        });
      } catch (err) {
        console.warn("備份多媒體失敗:", m.filename, err);
      }
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
  const a = document.createElement("a");
  a.href = url;
  a.download = `${vaultName}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 匯出單篇 Markdown 檔案
 */
export function exportNoteMarkdown(note: Note): void {
  const blob = new Blob([note.content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${note.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 驗證並完整還原 Vault 備份檔案（還原筆記、資料夾結構、所有圖片與影片至 IndexedDB）
 */
export async function parseAndRestoreVaultBackup(jsonStr: string): Promise<{
  notes: Note[];
  mediaCount: number;
  folderCount: number;
}> {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("檔案非合法的 JSON 格式");
  }

  let notesArray: any[] = [];
  if (Array.isArray(parsed)) {
    notesArray = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.notes)) {
    notesArray = parsed.notes;
  } else {
    throw new Error("檔案結構缺少有效的筆記陣列");
  }

  if (notesArray.length === 0) {
    throw new Error("備份檔案中沒有任何筆記資料");
  }

  const validNotes: Note[] = [];
  const now = new Date().toISOString();

  for (const item of notesArray) {
    if (!item || typeof item !== "object") continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content : "";
    if (!title) continue;

    validNotes.push({
      id: typeof item.id === "string" && item.id ? item.id : `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      content,
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      folder: typeof item.folder === "string" ? item.folder : undefined,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
    });
  }

  if (validNotes.length === 0) {
    throw new Error("未能從檔案中解析出任何有效格式的筆記");
  }

  // 1. 還原自訂資料夾
  let folderCount = 0;
  if (parsed && Array.isArray(parsed.customFolders) && parsed.customFolders.length > 0) {
    const existing = getCustomFolders();
    const merged = Array.from(new Set([...existing, ...parsed.customFolders]));
    saveCustomFolders(merged);
    folderCount = parsed.customFolders.length;
  }

  // 2. 還原多媒體附件（無損圖片與影片）
  let mediaCount = 0;
  if (parsed && Array.isArray(parsed.media) && parsed.media.length > 0) {
    const attachments: MediaAttachment[] = [];
    for (const m of parsed.media) {
      if (m && m.dataUrl && m.id) {
        try {
          const blob = await dataUrlToBlob(m.dataUrl);
          attachments.push({
            id: m.id,
            filename: m.filename || "attachment",
            mimeType: m.mimeType || blob.type || "application/octet-stream",
            blob,
            size: m.size || blob.size,
            createdAt: m.createdAt || now,
          });
        } catch (e) {
          console.warn("還原媒體附件失敗:", m.filename, e);
        }
      }
    }
    if (attachments.length > 0) {
      await batchSaveMediaAttachments(attachments);
      mediaCount = attachments.length;
    }
  }

  // 3. 還原筆記至 IndexedDB
  await batchSaveNotesToDB(validNotes);

  return {
    notes: validNotes,
    mediaCount,
    folderCount,
  };
}

/**
 * 舊版相容介面
 */
export function validateAndParseVaultBackup(jsonStr: string): Note[] {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("檔案非合法的 JSON 格式");
  }
  const notesArray = Array.isArray(parsed) ? parsed : parsed?.notes || [];
  return notesArray.filter((n: any) => n && n.title);
}
