import { batchSaveNotesToDB, getAllNoteMetadata, getAllNotesFromDB } from "./db";
import { extractOutlinks, extractTags } from "./parser";
import { Note, VaultBackup } from "./types";

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
      title: "歡迎來到 Web Obsidian (高效能版)",
      content: `# 歡迎使用 Web Obsidian 知識庫 👋

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
- 輸入 \`[[筆記名稱]]\` 即可指向其他筆記，例如返回 [[歡迎來到 Web Obsidian (高效能版)]]。
- 若筆記尚未建立，點擊即可一鍵建立新頁面！
- 支援別名：\`[[筆記名稱|顯示別名]]\`。

## 媒體附件展示
未來可在此筆記中貼入截圖或短影片，系統將以二進位 Blob 形式安全存在本機，隨時在預覽區即時播放。
`,
      tags: ["筆記方法", "雙向連結"],
      outlinks: ["歡迎來到 Web Obsidian (高效能版)"],
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

  // 1. 檢查是否需要自 LocalStorage 遷移
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
          // 清除舊的大容量 JSON 避免佔用 5MB
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          return { migratedCount: notesToMigrate.length, isFirstInit: false };
        }
      }
    } catch (e) {
      console.warn("自 LocalStorage 遷移資料時發生異常:", e);
    }
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "true");
  }

  // 2. 檢查 IndexedDB 是否已有資料
  const existingMeta = await getAllNoteMetadata();
  if (existingMeta.length === 0) {
    const defaults = getDefaultNotes();
    await batchSaveNotesToDB(defaults);
    return { migratedCount: 0, isFirstInit: true };
  }

  return { migratedCount: 0, isFirstInit: false };
}

/**
 * 匯出完整 Vault JSON 備份檔（自 IndexedDB 提取完整筆記）
 */
export async function exportVaultJson(vaultName: string = "Obsidian-Vault"): Promise<void> {
  const notes = await getAllNotesFromDB();
  const backup: VaultBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    vaultName,
    notes,
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
 * 驗證並解析匯入之 Vault 備份檔案，並寫入 IndexedDB
 */
export function validateAndParseVaultBackup(jsonStr: string): Note[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("檔案非合法的 JSON 格式");
  }

  let notesArray: unknown[];
  if (Array.isArray(parsed)) {
    notesArray = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).notes)) {
    notesArray = (parsed as Record<string, unknown>).notes as unknown[];
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
    const n = item as Record<string, unknown>;
    const title = typeof n.title === "string" ? n.title.trim() : "";
    const content = typeof n.content === "string" ? n.content : "";
    if (!title) continue;

    validNotes.push({
      id: typeof n.id === "string" && n.id ? n.id : `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      content,
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      folder: typeof n.folder === "string" ? n.folder : undefined,
      createdAt: typeof n.createdAt === "string" ? n.createdAt : now,
      updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : now,
    });
  }

  if (validNotes.length === 0) {
    throw new Error("未能從檔案中解析出任何有效格式的筆記");
  }

  return validNotes;
}
