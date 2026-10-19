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

歡迎來到你的個人 Markdown 知識庫。這裡可以集中整理學習筆記、日記、工作紀錄、技術文件與靈感，並透過資料夾、標籤、雙向連結及圖譜建立自己的**第二大腦**。

這個網站以 **IndexedDB 本機資料庫**保存筆記及附件，主要資料儲存在你目前使用的瀏覽器中。重新整理通常不會遺失內容，但**不同裝置之間不會自動同步**；重要資料請定期匯出 ZIP 備份。

## 一、如何開始使用？

1. 在左側「檔案庫」按「＋」，建立一篇新筆記。
2. 點選筆記後，可切換上方的「編輯」、「雙欄」與「預覽」。
3. 在編輯模式使用 Markdown 語法整理標題、清單、引用、程式碼與連結。
4. 透過左側搜尋列找出筆記，也能依名稱、建立時間或修改時間排序。
5. 若需要分類，建立資料夾並將筆記拖曳至指定位置。

## 二、編輯、雙欄與預覽有什麼差別？

- **編輯**：直接輸入 Markdown 原始內容，適合寫作、修改和整理。
- **雙欄**：左邊編輯、右邊即時預覽，可以同時檢查排版效果。
- **預覽**：專心閱讀排版後的筆記，適合回顧和查找資訊。

常見 Markdown 寫法如下：

\`\`\`markdown
# 第一層標題
## 第二層標題
**粗體** 與 *斜體*
- 清單項目
> 這是一段引用
\`\`\`

若要在**同一個引用框**內換行，請在每行前面加上 \`>\`；要保留段落空隙，可以在兩段之間放一行單獨的 \`>\`。

## 三、如何使用資料夾和標籤？

- **資料夾**：用來安排筆記的實際分類，例如「日記」、「程式學習」與「工作紀錄」。
- **子資料夾**：可把同一主題再細分，方便管理大量筆記。
- **標籤**：在筆記中使用井字號標示主題，例如 \`#Java\`、\`#待整理\`，方便跨資料夾查找。
- **排序**：使用檔案庫上方的排序功能，選擇較適合自己的瀏覽方式。

一篇筆記可以屬於一個資料夾，但同時擁有多個標籤。資料夾適合管理位置，標籤適合整理主題。

## 四、雙向連結與關聯資訊

如果兩篇筆記之間有關係，可以用雙中括號建立連結。這篇筆記的相關教學請看：[[雙向連結與知識網絡]]。

- **出向連結**：目前筆記指向其他筆記。
- **反向連結（Backlinks）**：其他筆記指向目前這篇筆記。
- **圖譜視圖（Graph View）**：用節點與線條探索知識網絡。
- **全域與局部模式**：分別觀看整體關係或目前筆記周圍的關係。

若已啟用資料夾圖譜關聯功能，還能自行決定是否讓資料夾節點與直屬筆記連線，不必修改筆記文字。

## 五、圖片、影片與附件

你可以使用筆記上方的「檔案／媒體」上傳圖片、影片或一般附件，也可以把檔案拖曳到編輯區，或在支援的情況下貼上圖片。

- **內嵌圖片與影片**：在筆記中直接預覽媒體內容。
- **其他附件**：依檔案類型顯示項目，方便辨識與下載。
- **附件管理**：集中查看已儲存的檔案，協助處理不再有筆記引用的媒體。

附件同樣保存在目前瀏覽器的本機資料庫中，並不是自動上傳到雲端。

## 六、備份、還原與匯入筆記

左側欄底部提供「備份／還原」與「匯入筆記」：

- **匯出完整 ZIP 備份**：保存目前知識庫的筆記、資料夾與附件，適合定期保存重要資料。
- **完整還原**：使用先前的完整備份取代目前資料。操作前應先確認備份正確，避免覆蓋現有內容。
- **匯入筆記**：從筆記 ZIP 選擇新增或覆蓋同名筆記，適合移入教學範例或其他筆記。
- **匯出選取筆記**：只分享或保存需要的部分筆記，避免輸出整個知識庫。

建議每次大量匯入、刪除或調整前，都先匯出完整備份。**完整還原**與**匯入筆記**是不同操作，請不要混用。

## 七、自訂背景與滑鼠游標

點擊筆記上方的「外觀設定」，可以分別調整左側、中間及右側背景；上傳圖片時可先預覽及裁切顯示範圍，也能恢復原本的水墨背景。

若已安裝游標功能，也可以上傳自行下載的靜態或動畫游標檔案。外觀設定通常只保存在目前瀏覽器，不會隨筆記內容自動同步到其他裝置。

## 八、使用時要記住的三件事

1. **先記錄，再整理**：不必一開始就把所有筆記分類得很完美。
2. **利用連結建立脈絡**：讓相關知識可以互相被找到，而不只是各自存放。
3. **定期備份最重要**：清除網站資料、更換瀏覽器或更換裝置前，先匯出完整 ZIP。

想了解如何讓筆記彼此連接，請繼續閱讀 [[雙向連結與知識網絡]]。

標籤：#第二大腦 #知識管理`,
      tags: ["第二大腦", "知識管理"],
      outlinks: ["雙向連結與知識網絡"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "note-bi-links",
      title: "雙向連結與知識網絡",
      content: `# 雙向連結與知識網絡

雙向連結是知識庫的核心骨架。它的價值不只是讓你從一篇筆記跳到另一篇，而是讓原本分散的想法、日記、學習紀錄與工作資料，逐漸形成能夠互相查找的**知識網絡**。

## 一、什麼是雙向連結？

當「筆記 A」提到「筆記 B」，A 就建立了一條指向 B 的連結。

- **出向連結（Outlinks）**：這篇筆記主動連到哪些其他筆記。
- **反向連結（Backlinks）**：有哪些其他筆記曾經連到這篇筆記。
- **雙向查看**：即使 B 沒有寫回 A，也能在 B 的「反向連結」區域找到 A。

例如，這篇筆記可以直接連到 [[歡迎來到 Markdown 知識庫 (高效能版)]]；打開那篇筆記後，也可以透過右側的反向連結找到這裡。

## 二、如何建立筆記連結？

在編輯模式下，使用兩層中括號包住**目標筆記的名稱**。以下是常見寫法：

\`\`\`markdown
[[筆記名稱]]
[[筆記名稱#章節]]
[[筆記名稱|顯示別名]]
\`\`\`

- **一般連結**：連到指定筆記，適合整理相關主題。
- **章節連結**：直接連到目標筆記中的指定標題，適合長篇文件。
- **顯示別名**：畫面上顯示較短、較好讀的名稱，仍指向同一篇筆記。

請留意：筆記名稱需要能夠對應實際存在的筆記。若目標不存在，圖譜可能會將它顯示成尚未解析的節點。

## 三、反向連結和出向連結在哪裡看？

打開任一篇筆記，右側的「關聯資訊」面板會列出相關資訊：

- **反向連結**：哪些筆記引用了目前這篇筆記；可點擊來源筆記返回查閱。
- **出向連結**：目前這篇筆記連向哪些其他筆記；可點擊目標前往閱讀。
- **筆記資訊**：建立時間、最後修改時間、字數及連結數等資訊。

這些關聯由筆記內容產生；單純把兩篇筆記放在同一個資料夾，通常不等於建立筆記間的 \`[[連結]]\`。

## 四、如何用圖譜閱讀知識網絡？

點選左下方的「圖譜視圖」，可以用節點與線條觀察筆記關係。

- **全域圖譜**：查看知識庫中較大範圍的筆記與連線。
- **局部圖譜**：以目前選取的筆記為中心，觀察與它直接相關的節點。
- **搜尋節點**：依名稱查找筆記；也能拖動節點、移動畫布與縮放視角。

圖譜的連線是另一種閱讀方式，並不代表會自動更改筆記內容。

## 五、資料夾與筆記連結有什麼差別？

你可以把「2026/10/19」放在「日記」資料夾，方便管理檔案。但資料夾本身不是一篇名叫「日記」的筆記，因此不需要在每篇日記中加入不自然的文字連結。

若已安裝**資料夾圖譜關聯**功能，可以在左側資料夾旁或圖譜的設定中，選擇是否將該資料夾與直屬筆記相連。此功能應由使用者自行啟用；關閉時仍保留原有的獨立筆記圖譜。

## 六、建議的整理方式

1. 先建立一篇主題筆記，例如「Java 學習紀錄」。
2. 每當學到相關概念，就建立獨立筆記，例如「Class」、「Object」、「繼承」。
3. 在主題筆記內加入相關筆記的雙向連結。
4. 需要回顧時，從主題筆記或局部圖譜開始探索。
5. 定期檢查反向連結，補上被忽略的知識關係。

這樣做的目的不是讓每篇筆記都有很多連線，而是讓**真正相關的內容能被快速找到**。

## 七、常見問題

- **連結存在，但圖譜沒有連線？** 先確認目標筆記名稱是否一致，並切換到全域圖譜查看。
- **同名資料夾與筆記會相同嗎？** 不會；筆記連結與資料夾關聯是不同概念。
- **不想在文章中顯示連結？** 可以使用資料夾分類；若需要資料夾圖譜連線，則透過對應開關啟用。
- **只想看與目前筆記有關的內容？** 使用局部圖譜與右側的關聯資訊。

返回 [[歡迎來到 Markdown 知識庫 (高效能版)]]。

標籤：#筆記方法 #雙向連結`,
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

export type ImportMode = "new" | "overwrite";

export interface ImportPreview {
  titles: string[];
  matches: string[];
  additions: string[];
  mediaCount: number;
}

function noteTitleKey(title: string): string {
  return title.trim().toLocaleLowerCase();
}

export async function previewNotesZip(file: File | Blob): Promise<ImportPreview> {
  const loaded = await loadZipPackage(file);
  if (!loaded.notes.length) throw new Error("ZIP 中沒有可匯入的筆記");
  const existing = await getAllNoteMetadata();
  const titles = new Set(existing.map(n => noteTitleKey(n.title)));
  const matches: string[] = [];
  const additions: string[] = [];
  for (const note of loaded.notes) {
    if (titles.has(noteTitleKey(note.title))) matches.push(note.title);
    else additions.push(note.title);
  }
  return { titles: loaded.notes.map(n => n.title), matches, additions, mediaCount: loaded.media.length };
}

export async function importNotesZip(
  file: File | Blob,
  mode: ImportMode = "new"
): Promise<ImportNotesZipResult> {
  const loaded = await loadZipPackage(file);

  if (loaded.notes.length === 0) {
    throw new Error("ZIP 中沒有可匯入的筆記");
  }

  if (mode === "overwrite") {
    const keys = loaded.notes.map(n => noteTitleKey(n.title));
    if (new Set(keys).size !== keys.length) {
      throw new Error("ZIP 中含有重複名稱，無法安全覆蓋；請先調整筆記名稱");
    }
  }

  const existingNotes = await getAllNotesFromDB();

  const existingByTitle = new Map(existingNotes.map(n => [noteTitleKey(n.title), n]));
  const occupiedTitles = new Set(existingNotes.map(n => noteTitleKey(n.title)));

  const titleMap = new Map<string, string>();
  let renamedCount = 0;

  for (const sourceNote of loaded.notes) {
    const nextTitle = mode === "overwrite" && existingByTitle.has(noteTitleKey(sourceNote.title))
      ? existingByTitle.get(noteTitleKey(sourceNote.title))!.title
      : makeUniqueTitle(sourceNote.title, occupiedTitles);

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
      id: mode === "overwrite" && existingByTitle.has(noteTitleKey(sourceNote.title))
        ? existingByTitle.get(noteTitleKey(sourceNote.title))!.id
        : createId("note"),
      title: renamedTitle,
      content,
      tags: extractTags(content),
      outlinks: extractOutlinks(content),
      createdAt: mode === "overwrite" && existingByTitle.has(noteTitleKey(sourceNote.title))
        ? existingByTitle.get(noteTitleKey(sourceNote.title))!.createdAt
        : (sourceNote.createdAt || new Date().toISOString()),
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

