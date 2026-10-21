# 筆記 App v2 第 1 階段「本機核心」實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不需登入、純本機即可完整使用的 v2 筆記 App：Tiptap 區塊編輯器、Yjs 本機儲存、資料夾樹、筆記與區塊連結、反向連結、標籤、表格、全文搜尋、D 方案介面與外觀設定。

**Architecture:** Vite + React 單頁應用。四層：`adapters/`（儲存介面與 Dexie 實作）→ `core/`（純 TypeScript：知識庫、筆記文件、索引、搜尋、偏好）→ `features/`（編輯器與各介面區域）→ `ui/`（設計 token 與共用元件）。資料正本是 Yjs 文件，增量寫入同一個 Dexie 資料庫；衍生索引可重建。

**Tech Stack:** Vite、React 19、TypeScript（strict）、Tiptap 3、Yjs、y-prosemirror、Dexie、Zustand、Tailwind v4、Radix UI、dnd-kit、lowlight、markdown-it、DOMPurify、nanoid、fractional-indexing、@fontsource/noto-sans-tc、Vitest、fake-indexeddb、@testing-library/react、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-21-notes-v2-phase1-design.md`

## Global Constraints

- 所有 `@tiptap/*` 套件使用**同一個確切版本**（Tiptap 3.x，安裝時最新穩定版）；其他套件鎖定安裝時的確切版本（`package-lock.json` 進版控）
- TypeScript `strict: true`；`core/` 與 `adapters/` 不得 import React 或任何 `features/`、`ui/` 檔案（以 ESLint `no-restricted-imports` 強制）
- 單一檔案超過約 300 行即拆分
- 介面文字一律繁體中文；`<html lang="zh-Hant">`
- Dexie 資料庫名稱 `notes-v2`；**不使用 `y-indexeddb`**
- 同一文件增量達 **200** 筆時壓縮為快照
- 筆記文件快取上限 **20** 份
- 索引更新延遲 **1000 ms**（停止輸入後）
- 垃圾桶保留 **30 天**
- 單一附件上限 **100 MB**（104,857,600 bytes）
- 不重名規則：比對前去除前後空白、轉小寫；空白標題不參與比對，顯示為「未命名」
- 同步造成的重名後綴：`" (2)"`、`" (3)"`…
- 編號清單樣式依深度循環：`decimal` → `alpha` → `roman`
- 版面斷點：寬 ≥ 1440px、中 1100～1439px、窄 < 1100px
- 側欄寬度 220～360px、右側卡片寬度 280～420px
- 工具列快捷鍵 `Ctrl + \`（macOS `⌘ + \`）；快速切換 `Ctrl + K`（macOS `⌘ + K`）
- 預設強調色 `#4F4BC9`；8 種強調色在白底文字對比皆 ≥ 4.5:1
- 間距以 4px 為基數；動畫使用彈簧曲線 `cubic-bezier(0.32, 0.72, 0, 1)`
- 組字中（`event.isComposing` 或 `keyCode === 229`）任何自訂鍵盤行為不得攔截
- 效能：1,000 篇筆記冷啟動到可編輯 < 1.5 s；搜尋 < 100 ms；按鍵處理 < 16 ms
- 端對端測試在 Chromium 與 WebKit 皆須通過
- 合併至 `main`、刪除分支或資料、產生費用的動作須事先取得使用者同意

## Review Focus

1. **標題邊界輸入**：只有空白、大小寫不同（`SAP` 與 `sap`）、前後空白不同的標題 → 前兩者分別視為空白與重名，第三者視為重名。測試加在 Task 4
2. **資料夾移進自己的子資料夾** → 拒絕並丟出 `cycle` 錯誤，資料不變。測試加在 Task 4
3. **大量連續修改後重新開啟**（例如 500 次增量、跨越兩次壓縮）→ 內容與關閉前完全相同。測試加在 Task 2
4. **搜尋含正規表示式特殊字元**（`C++ (ME51N)`、`a.b*`）→ 依字面比對，不報錯。測試加在 Task 8
5. **組字中按 Enter**（Slash 選單開啟時、清單項目中）→ 只確認文字，不選取選單項目、不分割清單。測試加在 Task 13（工具函式）與 Task 17（Slash 選單）

---

## 檔案結構

```
.github/workflows/ci.yml
index.html  vite.config.ts  vitest.config.ts  playwright.config.ts  vercel.json
eslint.config.js  tsconfig.json  package.json
src/
  main.tsx                       掛載 App
  app/
    App.tsx                      服務就緒前顯示載入、就緒後顯示 Shell
    bootstrap.ts                 建立所有服務（AppServices）
    services-context.tsx         React context + useServices()
    ui-store.ts                  Zustand 介面狀態
  adapters/storage/
    types.ts                     StorageAdapter 介面、StorageError
    db.ts                        Dexie schema
    dexie-storage.ts             DexieStorage
    memory-storage.ts            MemoryStorage（無法儲存時的退路、測試用）
    persistence.ts               requestPersistence()
  core/
    ids.ts                       newId()
    order.ts                     orderBetween()、orderForIndex()
    persist.ts                   bindPersistence()
    tabs-bridge.ts               connectTabs()
    vault/
      types.ts  vault.ts  titles.ts  tree.ts
    note-doc/cache.ts            NoteDocCache
    extract/extract.ts           extractNote()
    links/link-mention.ts        linkMention()
    indexer/indexer.ts           Indexer
    search/search.ts             searchNotes()、findMentions()
    search/search-client.ts      SearchClient（Worker 包裝）
    preferences/
      preferences.ts  accents.ts  contrast.ts
  workers/search.worker.ts
  ui/
    tokens.css                   Tailwind @theme 設計 token
    glass.css  fonts.ts  icons.tsx
    components/                  Button, IconButton, Menu, Dialog, Tooltip, Banner
  features/
    shell/       Shell.tsx, Background.tsx, layout-mode.ts, ResizeHandle.tsx, StorageBanner.tsx
    rail/        Rail.tsx, use-rail.ts
    sidebar/     Sidebar.tsx, FolderTree.tsx, TreeItem.tsx, TrashView.tsx, use-vault.ts
    panel/       Panel.tsx, Outline.tsx, Backlinks.tsx
    search/      QuickSwitcher.tsx
    settings/    SettingsDialog.tsx, background-busyness.ts, apply-preferences.ts
    editor/
      NoteEditor.tsx  TitleBlock.tsx  extensions.ts  ime.ts
      blocks/       block-id.ts, ordered-list.ts, task-item.tsx, list-moves.ts,
                    callout.tsx, code-block.ts, abap.ts, table.ts, media.tsx
      marks/        formatting.ts
      links/        note-link.tsx, link-suggestion.tsx, tag.tsx, block-link-clipboard.ts
      menus/        FormatToolbar.tsx, SlashMenu.tsx, slash-items.ts, DragHandleMenu.tsx
      paste/        markdown-paste.ts
      media/        add-media.ts, use-blob-url.ts
e2e/            *.spec.ts
scripts/bench.ts
docs/manual-ime-checklist.md
```

> 與規格 7.6 的差異：新增衍生資料表 `blocks`（`noteId, blockId, type, text`），供 `[[筆記#` 搜尋區塊與區塊連結顯示片段使用。它是衍生資料，可重建，不改變規格的任何決策。

---

### Task 1: 專案骨架與自動檢查

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `index.html`, `vercel.json`, `.github/workflows/ci.yml`, `src/main.tsx`, `src/app/App.tsx`, `src/smoke.test.ts`, `e2e/smoke.spec.ts`, `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`；路徑別名 `@/` → `src/`

- [ ] **Step 1: 建立 Vite React TypeScript 專案並安裝依賴**（Tech Stack 全部套件；開發依賴含 Vitest、jsdom、fake-indexeddb、@testing-library/react、Playwright、ESLint、Tailwind v4 + `@tailwindcss/vite`）
- [ ] **Step 2: 寫 smoke 測試** — `src/smoke.test.ts`：`expect(1 + 1).toBe(2)`；`e2e/smoke.spec.ts`：開首頁後 `expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant')`
- [ ] **Step 3: 設定**：`vitest.config.ts` 環境 `jsdom`、setup 檔載入 `fake-indexeddb/auto`；`playwright.config.ts` 專案 `chromium`、`webkit`，`webServer` 跑 `vite preview`；ESLint 規則 `no-restricted-imports` 禁止 `src/core/**`、`src/adapters/**` import `react`、`@/features/*`、`@/ui/*`；`vercel.json` 將所有路徑 rewrite 到 `/index.html`
- [ ] **Step 4: CI** — `.github/workflows/ci.yml`：Node 22，`npm ci` → `typecheck` → `lint` → `test` → `build` → `npx playwright install --with-deps chromium webkit` → `test:e2e`；觸發於 push 與 pull_request
- [ ] **Step 5: 執行** `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`，預期全部通過
- [ ] **Step 6: Commit** `chore: scaffold v2 app with tests and CI`

---

### Task 2: 儲存轉接層與文件持久化

**Files:**
- Create: `src/adapters/storage/{types,db,dexie-storage,memory-storage,persistence}.ts`, `src/core/persist.ts`, `src/core/ids.ts`
- Test: `src/adapters/storage/dexie-storage.test.ts`, `src/core/persist.test.ts`

**Interfaces:**
- Produces:
```ts
// types.ts
export interface StorageAdapter {
  loadDoc(docId: string): Promise<Uint8Array[]>;          // 快照（若有）在前，其後依 seq 排序的增量
  appendUpdate(docId: string, update: Uint8Array): Promise<number>; // 回傳此文件目前增量筆數
  compact(docId: string, state: Uint8Array): Promise<void>;          // 寫入快照並刪除所有增量
  deleteDoc(docId: string): Promise<void>;
  listDocs(): Promise<string[]>;
  putBlob(id: string, blob: Blob): Promise<void>;
  getBlob(id: string): Promise<Blob | undefined>;
  deleteBlob(id: string): Promise<void>;
}
export class StorageError extends Error { kind: 'quota' | 'unavailable' | 'unknown' }
// db.ts
export function createDb(name?: string): NotesDb  // 預設 'notes-v2'；tables: updates, snapshots, blobs, noteText, links, blocks, tags, meta
// persistence.ts
export function requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'>
// ids.ts
export function newId(): string   // nanoid 21 字元
// persist.ts
export const PERSIST_ORIGIN: unique symbol
export function bindPersistence(doc: Y.Doc, docId: string, storage: StorageAdapter,
  opts?: { compactAfter?: number; ignoreOrigins?: unknown[]; onError?: (e: StorageError) => void }): Promise<{ destroy(): void }>
```

- [ ] **Step 1: 寫失敗測試**（`dexie-storage.test.ts`）
  - `appendUpdate` 兩次後 `loadDoc` 依序回傳兩筆
  - `compact` 後 `loadDoc` 只回傳一筆快照，`appendUpdate` 再回傳 1
  - `deleteDoc` 後 `listDocs` 不含該 id
  - `putBlob`／`getBlob` 往返後 `size` 相同
  - 寫入時底層拋出 `QuotaExceededError` → 轉成 `StorageError` 且 `kind === 'quota'`
  - `MemoryStorage` 跑同一組測試（以共用的 `describeStorageContract(factory)` 實作）
- [ ] **Step 2: 寫失敗測試**（`persist.test.ts`）
  - 綁定後在 `Y.Doc` 寫入文字，新建一份 `Y.Doc` 綁定同一 docId → 內容相同
  - `compactAfter: 200` 時連續寫入 **500** 次（Review Focus 3）→ 重新開啟內容相同，且 `loadDoc` 回傳筆數 < 200
  - origin 在 `ignoreOrigins` 內的更新不寫入
  - 載入時套用的更新不會再被寫回（不重複寫入）
- [ ] **Step 3: 執行** `npx vitest run src/adapters src/core/persist.test.ts`，預期 FAIL
- [ ] **Step 4: 實作** — Dexie 交易包住寫入；`appendUpdate` 在同一交易中計數；`bindPersistence` 以 `Y.applyUpdate(doc, u, PERSIST_ORIGIN)` 載入，監聽 `doc.on('update')`，計數達 `compactAfter`（預設 200）時以 `Y.encodeStateAsUpdate(doc)` 呼叫 `compact`；寫入失敗呼叫 `onError` 並將該增量保留在記憶體佇列，下次成功寫入時一併補寫
- [ ] **Step 5: 執行** 同上，預期 PASS
- [ ] **Step 6: Commit** `feat(storage): dexie storage adapter and yjs persistence`

---

### Task 3: 跨分頁同步橋

**Files:**
- Create: `src/core/tabs-bridge.ts`
- Test: `src/core/tabs-bridge.test.ts`

**Interfaces:**
- Consumes: Task 2 `bindPersistence` 的 `ignoreOrigins`
- Produces:
```ts
export const TAB_ORIGIN: unique symbol
export function connectTabs(doc: Y.Doc, docId: string,
  channelFactory?: (name: string) => BroadcastChannel): () => void  // 頻道名稱 `notes-v2:${docId}`
```

- [ ] **Step 1: 寫失敗測試** — 以記憶體版頻道模擬兩個分頁：A 文件寫入後 B 文件內容相同；B 套用時 origin 為 `TAB_ORIGIN`；B 不會把收到的更新再廣播回去；呼叫回傳的函式後不再收發
- [ ] **Step 2: 執行** `npx vitest run src/core/tabs-bridge.test.ts`，預期 FAIL
- [ ] **Step 3: 實作** — 本地更新（origin ≠ `TAB_ORIGIN`）廣播；收到時 `Y.applyUpdate(doc, u, TAB_ORIGIN)`；新分頁加入時送出自己的 state vector，對方回覆差異（`Y.encodeStateAsUpdate(doc, sv)`）。持久化時須把 `TAB_ORIGIN` 放進 `ignoreOrigins`（由原分頁負責寫入）
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): broadcast yjs updates across tabs`

---

### Task 4: 知識庫結構文件（Vault）

**Files:**
- Create: `src/core/vault/{types,vault,titles,tree}.ts`, `src/core/order.ts`
- Test: `src/core/vault/vault.test.ts`, `src/core/vault/titles.test.ts`, `src/core/vault/tree.test.ts`, `src/core/order.test.ts`

**Interfaces:**
- Consumes: Task 2 `StorageAdapter`、`bindPersistence`、`newId`；Task 3 `connectTabs`
- Produces:
```ts
// types.ts
export type NoteMeta = { id: string; title: string; folderId: string | null; order: string;
  createdAt: number; updatedAt: number; deletedAt: number | null };
export type FolderMeta = { id: string; name: string; parentId: string | null; order: string;
  createdAt: number; deletedAt: number | null };
export type AttachmentMeta = { id: string; filename: string; mimeType: string; size: number; createdAt: number };
export class VaultError extends Error { code: 'duplicate-title' | 'not-found' | 'cycle' }
// titles.ts
export function normalizeTitle(t: string): string           // trim + toLowerCase
export function displayTitle(t: string): string             // 空白 → '未命名'
export function dedupeTitle(title: string, taken: Set<string>): string  // 'X' → 'X (2)' → 'X (3)'
// order.ts
export function orderForIndex(siblingOrders: string[], index: number): string
// tree.ts
export type TreeNode = { kind: 'folder'; folder: FolderMeta; children: TreeNode[] } | { kind: 'note'; note: NoteMeta };
export function buildTree(folders: FolderMeta[], notes: NoteMeta[]): TreeNode[]  // 排除已刪除；資料夾在前；同層依 order
// vault.ts
export class Vault {
  static open(storage: StorageAdapter, vaultId: string): Promise<Vault>;
  readonly doc: Y.Doc;
  listNotes(o?: { includeTrashed?: boolean }): NoteMeta[];
  getNote(id: string): NoteMeta | undefined;
  listFolders(o?: { includeTrashed?: boolean }): FolderMeta[];
  isTitleAvailable(title: string, exceptId?: string): boolean;
  createNote(i?: { title?: string; folderId?: string | null; index?: number }): NoteMeta;
  renameNote(id: string, title: string): void;
  moveNote(id: string, to: { folderId: string | null; index: number }): void;
  touchNote(id: string): void;
  trashNote(id: string): void; restoreNote(id: string): void;
  purgeNote(id: string): void;                                   // 從結構文件移除
  createFolder(i: { name: string; parentId: string | null; index?: number }): FolderMeta;
  renameFolder(id: string, name: string): void;
  moveFolder(id: string, to: { parentId: string | null; index: number }): void;
  trashFolder(id: string): void; restoreFolder(id: string): void;
  purgeExpired(now: number, referencedAttachmentIds?: Set<string>): { noteIds: string[]; attachmentIds: string[] };  // 超過 30 天
  addAttachment(a: Omit<AttachmentMeta, 'id' | 'createdAt'>): AttachmentMeta;
  resolveDuplicateTitles(): string[];                            // 回傳被改名的筆記 id
  observe(cb: () => void): () => void;
  close(): void;
}
```

- [ ] **Step 1: 寫失敗測試**（`titles.test.ts`、`order.test.ts`、`tree.test.ts`）
  - `normalizeTitle('  SAP ') === 'sap'`；`displayTitle('   ') === '未命名'`
  - `dedupeTitle('採購', new Set(['採購', '採購 (2)']))` 為 `'採購 (3)'`
  - `orderForIndex` 在任意位置插入的結果，排序後位置正確（插入頭、中、尾各一例）
  - `buildTree`：巢狀資料夾正確、已刪除項目不出現、資料夾排在筆記前
- [ ] **Step 2: 寫失敗測試**（`vault.test.ts`，使用 `MemoryStorage`）
  - 新建筆記後重新開啟仍在
  - 重名：已有「SAP」時 `renameNote(x, 'sap')`、`renameNote(x, ' SAP ')` 皆丟出 `duplicate-title`（Review Focus 1）；兩篇空白標題可並存
  - `moveFolder(a, { parentId: a的孫資料夾 })` 丟出 `cycle`，結構不變（Review Focus 2）
  - `trashFolder` 連帶子資料夾與筆記的 `deletedAt` 皆設定；`restoreFolder` 全部恢復；父資料夾已清除時還原到最上層（`parentId: null`）
  - `purgeExpired(now)`：`deletedAt` 為 31 天前者被移除並回傳 id；29 天前者保留；回傳只被已清除筆記引用的附件 id
  - `resolveDuplicateTitles`：兩篇都叫「X」時，`createdAt` 較晚者改為「X (2)」
  - `observe` 在任一修改後被呼叫
- [ ] **Step 3: 執行** `npx vitest run src/core/vault src/core/order.test.ts`，預期 FAIL
- [ ] **Step 4: 實作** — 每個筆記與資料夾為巢狀 `Y.Map`；所有指令包在 `doc.transact`；`orderForIndex` 以 `fractional-indexing` 的 `generateKeyBetween` 取前後鄰居；附件引用以掃描筆記索引的 `extractNote` 結果判斷——為避免依賴後續任務，`purgeExpired` 接受選用參數 `referencedAttachmentIds: Set<string>`（預設空集合）
- [ ] **Step 5: 執行**，預期 PASS
- [ ] **Step 6: Commit** `feat(core): vault structure document with commands`

---

### Task 5: 筆記文件快取

**Files:**
- Create: `src/core/note-doc/cache.ts`
- Test: `src/core/note-doc/cache.test.ts`

**Interfaces:**
- Consumes: Task 2、Task 3
- Produces:
```ts
export class NoteDocError extends Error { code: 'corrupted' }
export class NoteDocCache {
  constructor(storage: StorageAdapter, opts?: { max?: number; onStorageError?: (e: StorageError) => void });
  acquire(noteId: string): Promise<Y.Doc>;   // 參考計數 +1；文件含 meta.schemaVersion = 1 與 content: Y.XmlFragment
  release(noteId: string): void;             // 參考計數 −1
  peek(noteId: string): Y.Doc | undefined;
  remove(noteId: string): Promise<void>;     // 刪除儲存資料
  onChange(cb: (noteId: string, doc: Y.Doc) => void): () => void;  // 任何已載入文件更新時
}
```

- [ ] **Step 1: 寫失敗測試** — 同一 id 兩次 `acquire` 回傳同一份 `Y.Doc`；`max: 20` 時第 21 份載入後，最久未用且參考計數為 0 者被釋放（`peek` 為 `undefined`），參考計數 > 0 者不釋放；損壞資料（無法套用的位元組）→ `acquire` 丟出 `corrupted`，且儲存中的原始資料仍在（`loadDoc` 長度不變）
- [ ] **Step 2: 執行** `npx vitest run src/core/note-doc`，預期 FAIL
- [ ] **Step 3: 實作** — 每份文件以 `bindPersistence`（`ignoreOrigins: [TAB_ORIGIN]`）與 `connectTabs` 綁定；釋放時呼叫兩者的 destroy
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): note document cache with LRU release`

---

### Task 6: 筆記內容擷取與連結轉換

**Files:**
- Create: `src/core/extract/extract.ts`, `src/core/links/link-mention.ts`
- Test: `src/core/extract/extract.test.ts`, `src/core/links/link-mention.test.ts`

**Interfaces:**
- Produces:
```ts
export type ExtractedBlock = { id: string; type: string; text: string };
export type ExtractedLink = { sourceBlockId: string; targetNoteId: string; targetBlockId: string | null; snippet: string };
export function extractNote(content: Y.XmlFragment): {
  text: string; blocks: ExtractedBlock[]; links: ExtractedLink[]; tags: string[]; attachmentIds: string[] };
export function linkMention(content: Y.XmlFragment, title: string, targetNoteId: string): boolean;
```
- 節點名稱約定（編輯器任務必須使用相同名稱）：區塊屬性 `id`；行內節點 `noteLink`（屬性 `noteId`、`blockId`）、`tag`（屬性 `name`）；媒體節點 `media`（屬性 `attachmentId`）

- [ ] **Step 1: 寫失敗測試** — 以 `Y.XmlElement` 手動建立：段落含文字、`noteLink`、`tag` → `text` 含段落文字、`links` 一筆且 `snippet` 為該段落前 80 字、`tags` 去重小寫、`blocks` 每個帶 id 的區塊一筆；巢狀清單的子項目也被擷取；`media` 節點的 `attachmentId` 被收集。`linkMention`：段落「依採購流程追蹤」把第一個不在 `noteLink` 內的「採購流程」換成 `noteLink`，回傳 `true`；找不到時回傳 `false` 且內容不變
- [ ] **Step 2: 執行** `npx vitest run src/core/extract src/core/links`，預期 FAIL
- [ ] **Step 3: 實作** — 遞迴走訪 XmlFragment；區塊之間以換行串接；`linkMention` 比對不分大小寫，在 `Y.XmlText` 上刪除該範圍並插入 `noteLink` 元素
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): extract text, links and tags from note documents`

---

### Task 7: 索引器

**Files:**
- Create: `src/core/indexer/indexer.ts`
- Test: `src/core/indexer/indexer.test.ts`

**Interfaces:**
- Consumes: Task 4 `Vault`、Task 5 `NoteDocCache`、Task 6 `extractNote`、Task 2 `createDb`
- Produces:
```ts
export type NoteTextRow = { noteId: string; title: string; text: string; updatedAt: number };
export type LinkRow = ExtractedLink & { sourceNoteId: string };
export type BlockRow = ExtractedBlock & { noteId: string };
export class Indexer {
  constructor(db: NotesDb, vault: Vault, notes: NoteDocCache, storage: StorageAdapter, opts?: { debounceMs?: number });
  start(): () => void;                       // 監聽 notes.onChange 與 vault.observe
  indexNote(noteId: string): Promise<void>;
  removeNote(noteId: string): Promise<void>;
  rebuildAll(): Promise<void>;               // 逐篇從儲存載入（不經快取），重算全部衍生表
  referencedAttachmentIds(): Promise<Set<string>>;
}
```

- [ ] **Step 1: 寫失敗測試**（以 fake timers）— 編輯筆記後 999 ms 內 `noteText` 未更新、1000 ms 後更新；改名後 `noteText.title` 更新；`links` 表可查到指向目標的來源；筆記進垃圾桶時其列仍保留（顯示「已刪除」需要），`purge` 後移除；手動破壞 `noteText` 後 `rebuildAll` 恢復正確內容
- [ ] **Step 2: 執行** `npx vitest run src/core/indexer`，預期 FAIL
- [ ] **Step 3: 實作** — 每篇筆記獨立的 debounce 計時器（預設 1000）；寫入在單一 Dexie 交易中替換該筆記的 `links`、`blocks`、`tags` 列
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): background indexer for search, links and tags`

---

### Task 8: 全文搜尋

**Files:**
- Create: `src/core/search/search.ts`, `src/core/search/search-client.ts`, `src/workers/search.worker.ts`
- Test: `src/core/search/search.test.ts`

**Interfaces:**
- Consumes: Task 7 `NoteTextRow`
- Produces:
```ts
export type SearchHit = { noteId: string; title: string; field: 'title' | 'tag' | 'content'; snippet: string; updatedAt: number };
export function searchNotes(query: string, rows: NoteTextRow[], tags: Map<string, string[]>, opts?: { limit?: number }): SearchHit[]; // limit 預設 50
export function findMentions(title: string, rows: NoteTextRow[], excludeNoteIds: Set<string>): SearchHit[];
export class SearchClient {   // 在 Worker 中執行 searchNotes／findMentions；Worker 從 Dexie 讀取資料並在 noteText 變更時更新記憶體快取
  search(query: string): Promise<SearchHit[]>;
  mentions(title: string, excludeNoteIds: string[]): Promise<SearchHit[]>;
  dispose(): void;
}
```

- [ ] **Step 1: 寫失敗測試**
  - 中文片段：內文「建立採購申請」搜「購申」命中
  - 排序：標題命中 > 標籤命中 > 內文命中；同級依 `updatedAt` 新到舊
  - 不分大小寫：「me51n」命中「ME51N」
  - 字面比對（Review Focus 4）：`C++ (ME51N)`、`a.b*` 不丟錯，且只命中確實含該字串者
  - `snippet`：命中位置前後各 30 字，前後有截斷時加「…」
  - 空白查詢回傳空陣列
  - `findMentions` 排除指定 id、排除自己
- [ ] **Step 2: 執行** `npx vitest run src/core/search`，預期 FAIL
- [ ] **Step 3: 實作** — 以 `toLowerCase` + `indexOf` 比對（不使用正規表示式）；Worker 以 `postMessage` 請求／回應，每個請求帶遞增 id
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): literal full-text search in a worker`

---

### Task 9: 個人偏好與強調色

**Files:**
- Create: `src/core/preferences/{preferences,accents,contrast}.ts`
- Test: `src/core/preferences/preferences.test.ts`, `src/core/preferences/accents.test.ts`

**Interfaces:**
- Produces:
```ts
export type Tri = 'system' | 'on' | 'off';
export type Prefs = {
  accent: string; backgroundBlobId: string | null; backgroundBlur: number; backgroundDim: number;   // 0–1
  fontSize: 'small' | 'standard' | 'large'; lineHeight: 'compact' | 'standard' | 'relaxed';
  editorWidth: 'narrow' | 'standard' | 'wide'; railMode: 'hover' | 'pinned';
  sidebarWidth: number; panelWidth: number; reduceMotion: Tri; reduceTransparency: Tri };
export const DEFAULT_PREFS: Prefs;   // accent '#4F4BC9', sidebarWidth 256, panelWidth 300, 其餘取 'standard'/'hover'/'system'，blur 0.5、dim 0.15
export const ACCENTS: { id: string; name: string; hex: string }[];   // 8 色
export function contrastRatio(a: string, b: string): number;
export class Preferences {
  static open(storage: StorageAdapter, userId?: string): Promise<Preferences>;  // userId 預設 'local'
  get(): Prefs; set(patch: Partial<Prefs>): void; observe(cb: (p: Prefs) => void): () => void; close(): void;
}
```
- 8 色初稿：靛紫 `#4F4BC9`、藍 `#1F63D6`、青 `#0B7A75`、綠 `#1F7A4D`、橘 `#B45309`、紅 `#C2362B`、桃紅 `#B83280`、石墨 `#3A3A3C`（測試不通過者調暗至通過）

- [ ] **Step 1: 寫失敗測試** — `contrastRatio('#000000', '#FFFFFF')` 約為 21；`ACCENTS` 長度 8 且每一色對 `#FFFFFF` ≥ 4.5；`ACCENTS[0].hex === '#4F4BC9'`；`set` 後重新開啟值仍在；`sidebarWidth` 設 500 時被限制為 360、設 100 時為 220；`panelWidth` 限制 280～420；未設定的欄位回傳 `DEFAULT_PREFS` 值
- [ ] **Step 2: 執行** `npx vitest run src/core/preferences`，預期 FAIL
- [ ] **Step 3: 實作** — 偏好存在 docId `prefs:${userId}` 的 `Y.Map('prefs')`；對比依 WCAG 相對亮度公式
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(core): synced preferences and accent palette`

---

### Task 10: 啟動流程與介面狀態

**Files:**
- Create: `src/app/{bootstrap.ts,services-context.tsx,ui-store.ts}`, `src/features/shell/StorageBanner.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/bootstrap.test.ts`, `src/app/ui-store.test.ts`

**Interfaces:**
- Consumes: Task 2～9
- Produces:
```ts
export type AppServices = { storage: StorageAdapter; db: NotesDb; vault: Vault; notes: NoteDocCache;
  indexer: Indexer; search: SearchClient; prefs: Preferences;
  persistence: 'granted' | 'denied' | 'unsupported'; storageMode: 'persistent' | 'memory';
  storageErrors: { subscribe(cb: (e: StorageError) => void): () => void } };
export function bootstrap(opts?: { dbName?: string }): Promise<AppServices>;
export function useServices(): AppServices;
export type Panel = 'none' | 'outline' | 'backlinks';
export const useUi: UseBoundStore<StoreApi<{
  openNoteId: string | null; panel: Panel; railHover: boolean; quickSwitcherOpen: boolean;
  sidebarOverlayOpen: boolean; settingsOpen: boolean; highlightBlockId: string | null;
  openNote(id: string, blockId?: string): void; setPanel(p: Panel): void; togglePanel(p: Exclude<Panel, 'none'>): void;
  setRailHover(v: boolean): void; setQuickSwitcher(v: boolean): void; setSidebarOverlay(v: boolean): void;
  setSettings(v: boolean): void; clearHighlight(): void }>>;
```

- [ ] **Step 1: 寫失敗測試**
  - 首次 `bootstrap` 建立一篇歡迎筆記（標題「歡迎使用」），`meta.lastNoteId` 指向它
  - 第二次 `bootstrap`（同 dbName）不重複建立，筆記數不變
  - Dexie 開啟失敗時 `storageMode === 'memory'` 且仍可建立筆記
  - 啟動時呼叫 `vault.purgeExpired`，31 天前刪除的筆記文件從儲存中移除
  - `togglePanel('backlinks')` 兩次後 `panel === 'none'`；`openNote(id, b)` 設定 `highlightBlockId === b`
- [ ] **Step 2: 執行** `npx vitest run src/app`，預期 FAIL
- [ ] **Step 3: 實作** — `App.tsx` 在 `bootstrap` 完成前顯示置中的載入狀態，完成後以 `ServicesProvider` 包住 `Shell`；`openNote` 同時寫入 `meta.lastNoteId`。`StorageBanner` 文案：
  - memory：「目前的瀏覽器模式無法保存資料，關閉視窗後內容會消失。」
  - quota：「儲存空間不足，最近的修改尚未存檔。可以匯出筆記或刪除大型附件來釋放空間。」
  - unknown：「存檔時發生問題，系統會自動重試。若持續發生，請重新整理頁面。」
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(app): bootstrap services and ui state`

---

### Task 11: 設計 token 與共用元件

**Files:**
- Create: `src/ui/{tokens.css,glass.css,fonts.ts,icons.tsx}`, `src/ui/components/{Button,IconButton,Menu,Dialog,Tooltip,Banner}.tsx`
- Test: `src/ui/components/components.test.tsx`

**Interfaces:**
- Produces: Tailwind `@theme` token：間距 4px 基數；圓角 `--radius-control: 8px`、`--radius-card: 16px`；字級 12/13/14/16/22/38px；陰影 `--shadow-card`、`--shadow-float`；`--ease-spring: cubic-bezier(0.32, 0.72, 0, 1)`；顏色 `--accent`（由偏好注入）、中性色 `--fg #1D1D1F`、`--fg-secondary #6E6E73`、`--fg-tertiary #86868B`、`--surface #FFFFFF`、`--fill rgba(0,0,0,0.05)`。CSS class `.glass-card`、`.glass-float`；`html[data-reduce-transparency="true"]` 時兩者改為不透明白底；`html[data-reduce-motion="true"]` 時轉場時間為 0。元件：`Button`（variant `primary | secondary | ghost`）、`IconButton`（必填 `label` 作為 `aria-label`）、`Menu`／`Dialog`／`Tooltip`（Radix 包裝）、`Banner`（`tone: 'info' | 'warning' | 'error'`）。`icons.tsx` 匯出 1.9px 線條 SVG 圖示：`Folder, Search, Tag, Settings, Plus, ChevronDown, ChevronRight, Close, More, Link, Trash, Grip`
- `fonts.ts` 引入 `@fontsource/noto-sans-tc` 400/500/600；全域字型堆疊：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Noto Sans TC", sans-serif`

- [ ] **Step 1: 寫失敗測試** — `IconButton` 渲染出 `aria-label`；`Button variant="primary"` 有 `data-variant="primary"`；`Dialog` 按 Esc 關閉並把焦點還給觸發按鈕
- [ ] **Step 2: 執行** `npx vitest run src/ui`，預期 FAIL
- [ ] **Step 3: 實作**
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(ui): design tokens and base components`

---

### Task 12: 版面外框、隱藏式工具列與自動調整

**Files:**
- Create: `src/features/shell/{Shell,Background,ResizeHandle}.tsx`, `src/features/shell/layout-mode.ts`, `src/features/rail/{Rail.tsx,use-rail.ts}`
- Test: `src/features/shell/layout-mode.test.ts`, `src/features/rail/rail.test.tsx`, `e2e/layout.spec.ts`

**Interfaces:**
- Consumes: Task 10 `useUi`、`useServices`；Task 11 元件
- Produces: `layoutModeFor(width: number): 'wide' | 'medium' | 'narrow'`；`<Shell />` 內含插槽 `sidebar`、`main`、`panel`（後續任務填入）

- [ ] **Step 1: 寫失敗測試**
  - `layoutModeFor(1440) === 'wide'`、`layoutModeFor(1439) === 'medium'`、`layoutModeFor(1100) === 'medium'`、`layoutModeFor(1099) === 'narrow'`
  - Rail：滑鼠進入左緣 14px 感應區後工具列 `data-open="true"`；離開工具列後為 `false`；按 `Ctrl+\` 切換；`railMode: 'pinned'` 時永遠開啟；組字中按快捷鍵不切換
  - e2e：1500px 寬時右側卡片打開後與筆記卡片並排（兩者 boundingBox 不重疊）；1200px 時右側卡片浮在筆記上方（重疊且 `data-overlay="true"`）；1000px 時左側卡片預設隱藏，點工具列「檔案」後出現；拖曳側欄邊緣可改變寬度，且不超過 360px
- [ ] **Step 2: 執行** `npx vitest run src/features/shell src/features/rail && npx playwright test e2e/layout.spec.ts`，預期 FAIL
- [ ] **Step 3: 實作** — D 方案版面：背景層（偏好的背景圖或預設漸層）、14px 外距、卡片間距 14px、`glass-card` 左側卡片、白色筆記卡片、右側卡片；工具列垂直置中、從左滑出 320ms 彈簧曲線、浮於側欄上方不推動版面；ResizeHandle 拖曳時寫入 `prefs.sidebarWidth`／`panelWidth`
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(shell): floating card layout, hidden rail and responsive modes`

---

### Task 13: 編輯器基礎、區塊 id 與標題區塊

**Files:**
- Create: `src/features/editor/{NoteEditor.tsx,TitleBlock.tsx,extensions.ts,ime.ts}`, `src/features/editor/blocks/block-id.ts`
- Test: `src/features/editor/ime.test.ts`, `src/features/editor/blocks/block-id.test.ts`, `src/features/editor/title-block.test.tsx`

**Interfaces:**
- Consumes: Task 5 `NoteDocCache`、Task 4 `Vault`、Task 10 `useUi`
- Produces:
```ts
export function isComposingEvent(e: KeyboardEvent, view?: EditorView): boolean; // isComposing || keyCode 229 || view.composing
export type EditorContext = { vault: Vault; noteId: string; openNote(id: string, blockId?: string): void;
  searchBlocks(noteId: string, q: string): Promise<BlockRow[]>; db: NotesDb; storage: StorageAdapter };
export function createExtensions(doc: Y.Doc, ctx: EditorContext): Extension[];  // 後續任務往這裡加入擴充
export const BLOCK_TYPES: string[];   // 帶 id 屬性的節點：paragraph, heading, blockquote, bulletList, orderedList, listItem, taskList, taskItem, callout, codeBlock, table, horizontalRule, media
```
- 元件：`<NoteEditor noteId />`、`<TitleBlock noteId />`

- [ ] **Step 1: 寫失敗測試**
  - `isComposingEvent`：`isComposing: true` → true；`keyCode: 229` → true；一般 Enter → false
  - BlockId：新段落自動取得 21 字元 id；貼上複製的段落後兩段 id 不同；`Y.Doc` 往返後 id 保持不變
  - TitleBlock：輸入「SAP」時若已有「sap」顯示「已有同名筆記」且不寫入；Enter 將焦點移入編輯器；在內文第一行按上方向鍵回到標題；清空時顯示 placeholder「未命名」；從其他地方改名時畫面同步
- [ ] **Step 2: 執行** `npx vitest run src/features/editor`，預期 FAIL
- [ ] **Step 3: 實作** — Tiptap `Collaboration` 擴充綁定 `doc.getXmlFragment('content')`；基本節點：Document、Paragraph、Text、Heading（levels 1–3）、Blockquote、HorizontalRule、HardBreak、UndoRedo 由 `Collaboration` 的 Yjs undo 取代；BlockId 以 `appendTransaction` 為缺 id 或重複 id 的 `BLOCK_TYPES` 節點補上 `newId()`；`NoteEditor` 掛載時 `notes.acquire`、卸載時 `release`，載入失敗（`corrupted`）顯示「這篇筆記無法讀取。原始資料已保留，其他筆記不受影響。」；文件修改時呼叫 `vault.touchNote`（節流 5 秒）
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): yjs-bound tiptap editor, block ids and title block`

---

### Task 14: 清單、待辦與子樹移動

**Files:**
- Create: `src/features/editor/blocks/{ordered-list.ts,task-item.tsx,list-moves.ts}`
- Modify: `src/features/editor/extensions.ts`
- Test: `src/features/editor/blocks/lists.test.ts`, `e2e/lists.spec.ts`

**Interfaces:**
- Consumes: Task 13 `createExtensions`、`isComposingEvent`
- Produces: `orderedStyleForDepth(depth: number): 'decimal' | 'alpha' | 'roman'`；有序清單屬性 `listStyle: 'auto' | 'decimal' | 'alpha' | 'roman'`（預設 `auto`）；指令 `moveSubtreeUp`、`moveSubtreeDown`（`Alt+Shift+↑/↓`）

- [ ] **Step 1: 寫失敗測試**
  - `orderedStyleForDepth(0) === 'decimal'`、`(1) === 'alpha'`、`(2) === 'roman'`、`(3) === 'decimal'`
  - 第二層有序清單渲染 `data-list-style="alpha"`；設為 `roman` 後渲染 `roman`
  - 輸入 `1. ` 轉為有序清單、`- ` 轉為項目清單、`[] ` 轉為待辦
  - Tab／Shift+Tab 縮排與取消縮排帶著子項目一起移動
  - `moveSubtreeDown` 把含子項目的項目與下一個同層項目交換；組字中按快捷鍵不動作
  - e2e：在待辦項目中以鍵盤輸入 `123` 得到 `123`（已知問題回歸測試）；勾選後文字顯示刪除線樣式
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/blocks/lists.test.ts && npx playwright test e2e/lists.spec.ts`，預期 FAIL
- [ ] **Step 3: 實作** — 使用 `@tiptap/extension-list` 的 BulletList、OrderedList（擴充 `listStyle` 屬性與依深度的渲染）、ListItem、TaskList；TaskItem 以自訂 React node view 重寫：核取方塊為 `contentEditable={false}` 的獨立元素，文字內容容器使用 `NodeViewContent`，不在每次輸入時重建
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): lists, notion-style numbering, tasks and subtree moves`

---

### Task 15: 提示框、程式碼、表格

**Files:**
- Create: `src/features/editor/blocks/{callout.tsx,code-block.ts,abap.ts,table.ts}`
- Modify: `src/features/editor/extensions.ts`
- Test: `src/features/editor/blocks/rich-blocks.test.ts`

**Interfaces:**
- Consumes: Task 13
- Produces: 節點 `callout`（屬性 `icon: 'info' | 'warning' | 'tip'`，預設 `info`）；`codeBlock`（屬性 `language`）；表格節點 `table`/`tableRow`/`tableHeader`/`tableCell`；指令 `insertCallout()`、`insertTable()`（3×3、首列為標題列）；`abapLanguage`（highlight.js 語言定義）

- [ ] **Step 1: 寫失敗測試**
  - `insertCallout` 後文件有 `callout` 節點且內含可編輯段落
  - lowlight 以 `abap` 高亮 `SELECT SINGLE * FROM ekko INTO @DATA(ls_ekko) WHERE ebeln = @lv_ebeln.` 時 `SELECT`、`FROM`、`WHERE` 為關鍵字 class；`* 註解` 為註解 class
  - 程式碼區塊支援語言：`abap, javascript, typescript, java, sql, xml, json, css, bash, python, markdown`
  - `insertTable` 產生 3 列 3 欄；`addColumnAfter`、`deleteRow` 生效；Tab 移到下一格
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/blocks/rich-blocks.test.ts`，預期 FAIL
- [ ] **Step 3: 實作** — 程式碼區塊使用 `@tiptap/extension-code-block-lowlight`；ABAP 定義參考 v1 `lib/obsidian/abapHighlight.ts`（`v1-archive` 分支）重新撰寫；表格使用 `@tiptap/extension-table`，`resizable: true`
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): callout, highlighted code blocks and tables`

---

### Task 16: 文字格式、浮動格式列與貼上

**Files:**
- Create: `src/features/editor/marks/formatting.ts`, `src/features/editor/menus/FormatToolbar.tsx`, `src/features/editor/paste/markdown-paste.ts`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/NoteEditor.tsx`
- Test: `src/features/editor/paste/markdown-paste.test.ts`, `src/features/editor/menus/format-toolbar.test.tsx`

**Interfaces:**
- Produces: `looksLikeMarkdown(text: string): boolean`；`markdownToHtml(md: string): string`（markdown-it，`html: false`，再經 DOMPurify）

- [ ] **Step 1: 寫失敗測試**
  - `looksLikeMarkdown('# 標題\n- 項目')` 為 true；一般句子為 false
  - 貼上 `# 標題\n\n- a\n- b` 產生 heading 與 bulletList；貼上 `<script>alert(1)</script>文字` 只留下「文字」
  - 選取文字時格式列出現，含粗體、斜體、底線、刪除線、行內程式碼、連結、文字顏色、螢光標記、「轉為…」；沒有選取時不出現；按粗體後選取範圍有 `bold` mark
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/paste src/features/editor/menus/format-toolbar.test.tsx`，預期 FAIL
- [ ] **Step 3: 實作** — 擴充：Bold、Italic、Underline、Strike、Code、Link（`openOnClick: false`、自動偵測網址）、TextStyle + Color、Highlight（`multicolor: true`）；顏色與螢光各提供 6 色。格式列使用 Tiptap BubbleMenu，`glass-float` 材質
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): inline formatting, floating toolbar and markdown paste`

---

### Task 17: Slash 選單與拖曳把手

**Files:**
- Create: `src/features/editor/menus/{SlashMenu.tsx,slash-items.ts,DragHandleMenu.tsx}`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/NoteEditor.tsx`
- Test: `src/features/editor/menus/slash.test.tsx`, `src/features/editor/menus/drag-handle.test.tsx`

**Interfaces:**
- Consumes: Task 13～16 的指令；Task 18 `copyBlockLink`（Task 18 完成前選單中此項以 `disabled` 呈現，Task 18 再接上）
- Produces: `SLASH_ITEMS: { id: string; label: string; hint: string; aliases: string[]; run(editor: Editor): void }[]`，項目與順序：文字、標題 1、標題 2、標題 3、項目清單、編號清單、待辦清單、引用、提示框、程式碼、表格、分隔線、圖片或影片；`filterSlashItems(query: string): SlashItem[]`（比對 label 與 aliases，不分大小寫）

- [ ] **Step 1: 寫失敗測試**
  - 在空段落輸入 `/` 開啟選單；輸入 `標題` 只剩標題 1～3；方向鍵移動、Enter 執行並移除 `/標題` 文字；Esc 關閉並保留文字
  - 組字中按 Enter（`isComposing: true`）不執行選單項目，選單仍開啟（Review Focus 5）
  - 在段落中間（前面有文字）輸入 `/` 不開啟；在程式碼區塊中不開啟
  - 拖曳把手選單項目：轉換類型、複製區塊連結、刪除；「刪除」移除該區塊
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/menus`，預期 FAIL
- [ ] **Step 3: 實作** — Slash 使用 `@tiptap/suggestion`（`char: '/'`、`startOfLine: true`），選單為 `glass-float` 材質、帶圖示與說明文字；拖曳把手使用 `@tiptap/extension-drag-handle-react`
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): slash menu and drag handle`

---

### Task 18: 筆記連結、區塊連結與標籤

**Files:**
- Create: `src/features/editor/links/{note-link.tsx,link-suggestion.tsx,tag.tsx,block-link-clipboard.ts}`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/menus/DragHandleMenu.tsx`, `src/features/editor/NoteEditor.tsx`
- Test: `src/features/editor/links/links.test.tsx`, `e2e/links.spec.ts`

**Interfaces:**
- Consumes: Task 6 節點名稱約定；Task 7 `BlockRow`；Task 10 `openNote`
- Produces:
```ts
export function formatBlockLink(noteId: string, blockId: string | null): string;   // `[[note:${noteId}#${blockId}]]`，blockId 為 null 時省略 `#...`
export function parseBlockLink(text: string): { noteId: string; blockId: string | null } | null;
export function copyBlockLink(noteId: string, blockId: string): Promise<void>;
export function noteLinkLabel(vault: Vault, target: { noteId: string; blockId: string | null }, blockText?: string):
  { text: string; state: 'ok' | 'deleted-note' | 'deleted-block' };
```

- [ ] **Step 1: 寫失敗測試**
  - `noteLinkLabel`：一般 → 「採購流程」；區塊 → 「採購流程 › 核准層級依金額決定…」（區塊文字取前 20 字，超過加「…」）；筆記在垃圾桶 → `deleted-note`、文字「已刪除的筆記」；區塊不存在 → `deleted-block`、文字「已刪除的區塊」
  - `parseBlockLink(formatBlockLink('n1', 'b1'))` 往返相同；格式不符回傳 `null`
  - 輸入 `[[採` 出現建議清單含「採購流程」；選取後插入 `noteLink`；最後一項為「建立新筆記「採」」，選取後建立筆記並插入連結
  - 輸入 `[[採購流程#核准` 列出該筆記中文字含「核准」的區塊；選取後 `noteLink.blockId` 為該區塊 id
  - 貼上 `formatBlockLink` 文字時插入 `noteLink` 而非純文字
  - 目標筆記改名後，連結顯示文字同步更新
  - 輸入 `#採購 ` 產生 `tag` 節點；在網址或程式碼中的 `#` 不產生
  - e2e：點擊區塊連結 → 開啟目標筆記、該區塊捲入畫面並帶 `data-highlight="true"` 約 1.5 秒；刪除目標筆記後連結顯示「已刪除的筆記」，從垃圾桶還原後恢復
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/links && npx playwright test e2e/links.spec.ts`，預期 FAIL
- [ ] **Step 3: 實作** — `noteLink`、`tag` 為 inline atom 節點，React node view 以 `useSyncExternalStore` 訂閱 vault 與 `blocks` 表；建議清單使用 `@tiptap/suggestion`（`char: '[['`）；DragHandleMenu 接上「複製區塊連結」
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): note links, block links and tags`

---

### Task 19: 圖片與影片

**Files:**
- Create: `src/features/editor/blocks/media.tsx`, `src/features/editor/media/{add-media.ts,use-blob-url.ts}`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/menus/slash-items.ts`
- Test: `src/features/editor/media/media.test.ts`

**Interfaces:**
- Consumes: Task 2 `putBlob`/`getBlob`、Task 4 `addAttachment`
- Produces:
```ts
export const MAX_ATTACHMENT_BYTES = 104_857_600;
export class MediaError extends Error { code: 'too-large' | 'unsupported' }
export function addMedia(file: File, deps: { vault: Vault; storage: StorageAdapter }): Promise<{ attachmentId: string; kind: 'image' | 'video' }>;
export function useBlobUrl(attachmentId: string): string | null;   // 卸載時 revokeObjectURL
```

- [ ] **Step 1: 寫失敗測試** — 100 MB + 1 byte 的檔案丟出 `too-large`，錯誤訊息「檔案超過 100 MB，無法加入。」；`application/pdf` 丟出 `unsupported`，訊息「目前只支援圖片與影片。」；成功時 `vault` 的附件清單多一筆、`getBlob` 取得同大小資料；拖放與貼上圖片檔插入 `media` 節點
- [ ] **Step 2: 執行** `npx vitest run src/features/editor/media`，預期 FAIL
- [ ] **Step 3: 實作** — `media` 為 block atom 節點（屬性 `attachmentId`、`kind`、`width`），圖片可拖曳右下角調整寬度
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(editor): image and video attachments`

---

### Task 20: 側欄資料夾樹與垃圾桶

**Files:**
- Create: `src/features/sidebar/{Sidebar,FolderTree,TreeItem,TrashView}.tsx`, `src/features/sidebar/use-vault.ts`
- Test: `src/features/sidebar/sidebar.test.tsx`, `e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: Task 4 `Vault`、`buildTree`、`displayTitle`；Task 10 `useUi`
- Produces: `useVaultSnapshot(): { notes: NoteMeta[]; folders: FolderMeta[]; tree: TreeNode[]; trashed: { notes: NoteMeta[]; folders: FolderMeta[] } }`（以 `useSyncExternalStore` 訂閱 `vault.observe`）

- [ ] **Step 1: 寫失敗測試**
  - 樹狀顯示：資料夾帶展開箭頭、每層縮排 20px、目前開啟的筆記有 `aria-current="page"`
  - 展開狀態存入 Dexie `meta.expandedFolders`，重新整理後保持
  - 「新增筆記」按鈕在目前資料夾建立「未命名」筆記並開啟、標題區塊取得焦點
  - 右鍵選單：重新命名、新增子資料夾、移到垃圾桶；重新命名重名時顯示「已有同名筆記」
  - 垃圾桶列出已刪除項目與剩餘天數（「29 天後永久刪除」）；「還原」與「永久刪除」（需在畫面上再確認一次）生效
  - e2e：拖曳筆記到另一個資料夾後，樹狀結構更新且重新整理後仍在；同層拖曳改變順序
- [ ] **Step 2: 執行** `npx vitest run src/features/sidebar && npx playwright test e2e/sidebar.spec.ts`，預期 FAIL
- [ ] **Step 3: 實作** — 拖放使用 dnd-kit；底部顯示儲存狀態（`storageMode === 'memory'` 時「資料未保存」，否則「已儲存在此裝置」）
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(sidebar): folder tree with drag and drop and trash`

---

### Task 21: 右側卡片：大綱與反向連結

**Files:**
- Create: `src/features/panel/{Panel,Outline,Backlinks}.tsx`
- Test: `src/features/panel/panel.test.tsx`

**Interfaces:**
- Consumes: Task 7 `links` 表、Task 8 `SearchClient.mentions`、Task 6 `linkMention`、Task 5 `NoteDocCache`、Task 10 `useUi`

- [ ] **Step 1: 寫失敗測試**
  - 筆記卡片上方膠囊的「大綱」「反向連結 N」按鈕切換右側卡片，N 為已連結數；× 與 Esc 關閉
  - 大綱列出 H1～H3（依層級縮排），點擊後捲動到該標題；捲動時目前閱讀的標題有 `aria-current="location"`
  - 反向連結「已連結」顯示來源標題、所在資料夾路徑、片段，片段中的目前筆記名稱以強調色反白；點擊開啟來源並捲到來源區塊
  - 「提到但未連結」列出內文含目前標題但未連結者；「轉為連結」後該項目移到「已連結」
  - 無資料時顯示「還沒有其他筆記連結到這裡」
- [ ] **Step 2: 執行** `npx vitest run src/features/panel`，預期 FAIL
- [ ] **Step 3: 實作** — 「轉為連結」：`notes.acquire(sourceId)` → `linkMention(doc.getXmlFragment('content'), title, currentId)` → `release`
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(panel): outline and backlinks card`

---

### Task 22: 快速切換與搜尋

**Files:**
- Create: `src/features/search/QuickSwitcher.tsx`
- Test: `src/features/search/quick-switcher.test.tsx`, `e2e/search.spec.ts`

**Interfaces:**
- Consumes: Task 8 `SearchClient`、Task 4 `createNote`、Task 10 `useUi`

- [ ] **Step 1: 寫失敗測試**
  - `Ctrl+K`／`⌘+K` 與工具列「搜尋」開啟；Esc 關閉並把焦點還原
  - 空查詢顯示最近編輯的 8 篇
  - 結果分組「筆記」，每列顯示標題（命中處粗體）與路徑或「內文提到「…」」；方向鍵與 Enter 開啟
  - 沒有完全同名的筆記時，最後一列「新增筆記「查詢字」」
  - e2e：建立含「建立採購申請」的筆記，搜尋「購申」可找到並開啟
- [ ] **Step 2: 執行** `npx vitest run src/features/search && npx playwright test e2e/search.spec.ts`，預期 FAIL
- [ ] **Step 3: 實作** — Radix Dialog，`glass-float` 材質，寬 560px、距頂 110px；輸入以 80ms debounce 查詢
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(search): quick switcher with full-text results`

---

### Task 23: 設定頁與外觀套用

**Files:**
- Create: `src/features/settings/{SettingsDialog.tsx,background-busyness.ts,apply-preferences.ts}`
- Test: `src/features/settings/settings.test.tsx`, `src/features/settings/background-busyness.test.ts`, `src/features/settings/apply-preferences.test.ts`

**Interfaces:**
- Consumes: Task 9 `Preferences`、`ACCENTS`；Task 7 `rebuildAll`；Task 2 `putBlob`
- Produces:
```ts
export function measureBusyness(pixels: Uint8ClampedArray): number;                 // 0–1：亮度標準差正規化
export function effectiveBackground(p: Prefs, busyness: number): { blur: number; dim: number }; // busyness > 0.25 時 blur ≥ 0.6、dim ≥ 0.3
export function applyPreferences(p: Prefs, root: HTMLElement, media: { reduceMotion: boolean; reduceTransparency: boolean }): void;
```

- [ ] **Step 1: 寫失敗測試**
  - `applyPreferences` 設定 `--accent`、`--editor-width`（窄 600px、標準 680px、寬 820px）、`--font-size-body`（小 15px、標準 16px、大 18px）、`--line-height-body`（緊湊 1.6、標準 1.8、寬鬆 2.0）；`reduceMotion: 'system'` 依 `media` 決定 `data-reduce-motion`，`'on'`／`'off'` 直接覆蓋；`reduceTransparency` 同理
  - `measureBusyness` 純色圖接近 0、黑白棋盤格接近 1；`effectiveBackground` 依規則提高下限
  - 設定頁分區：背景（上傳、模糊度、淡化程度、恢復預設）、色彩、文字、版面、動態、資料（「重建索引」按鈕、持久儲存狀態說明）；選擇強調色後 `--accent` 立即改變；上傳背景後背景層使用該圖
- [ ] **Step 2: 執行** `npx vitest run src/features/settings`，預期 FAIL
- [ ] **Step 3: 實作** — 工具列「設定」開啟；持久儲存狀態文案：granted「瀏覽器已同意長期保存這些資料。」、denied「瀏覽器可能在空間不足時清除資料。之後開啟同步或自動備份可以保護你的筆記。」、unsupported「這個瀏覽器不支援長期保存設定。」
- [ ] **Step 4: 執行**，預期 PASS
- [ ] **Step 5: Commit** `feat(settings): appearance settings and preference application`

---

### Task 24: 整合驗收、效能基準與手動清單

**Files:**
- Create: `e2e/core-flow.spec.ts`, `e2e/tabs.spec.ts`, `scripts/bench.ts`, `docs/manual-ime-checklist.md`
- Modify: `package.json`（新增 script `bench`）

- [ ] **Step 1: 寫端對端測試**
  - `core-flow.spec.ts`：新增筆記 → 輸入標題與內文 → 加入筆記連結與區塊連結 → 加入表格、程式碼、待辦 → 重新整理後全部仍在 → 目標筆記的反向連結出現來源 → 改名目標後連結文字更新 → 刪除再還原
  - `tabs.spec.ts`：同一瀏覽器開兩個分頁，A 輸入的文字在 1 秒內出現在 B；B 新增的筆記出現在 A 的側欄
- [ ] **Step 2: 執行** `npx playwright test`，預期 Chromium 與 WebKit 全部 PASS（失敗則回到對應任務修正）
- [ ] **Step 3: 效能基準** — `scripts/bench.ts` 以 Playwright 開啟預覽站，透過測試用入口 `window.__bench.seed(1000)` 建立 1,000 篇各約 2,000 字的筆記；量測重新整理到編輯器可輸入的時間（< 1500 ms）、搜尋「採購」回應時間（< 100 ms）、在大型筆記中連續輸入 100 字的平均按鍵處理時間（< 16 ms）；`__bench` 僅在 `import.meta.env.MODE === 'bench'` 時掛載
- [ ] **Step 4: 執行** `npm run bench`，預期三項數值皆在門檻內並輸出結果表
- [ ] **Step 5: 手動清單** — `docs/manual-ime-checklist.md`：輸入法測試台的 12 個情境，加上 Slash 選單中組字、筆記連結建議中組字、表格儲存格中組字、標題區塊中組字；已知問題「待辦清單中輸入數字順序顛倒」列為必測
- [ ] **Step 6: Commit** `test: end-to-end flows, performance benchmark and manual IME checklist`

---

## 規格對照

| 規格章節 | 任務 |
|---|---|
| 4.1 區塊 | 13、14、15、19 |
| 4.1 文字格式、貼上 | 16 |
| 4.1 編輯操作（Slash、格式列、拖曳、縮排、子樹、復原） | 13、14、16、17 |
| 4.1 連結、區塊連結、標籤 | 18 |
| 4.1 反向連結、大綱 | 21 |
| 4.1 資料夾樹、垃圾桶 | 4、20 |
| 4.1 全文搜尋、快速切換 | 8、22 |
| 5 技術選型 | 1 |
| 6 分層 | 1（ESLint 限制）、全部 |
| 7 資料結構 | 2、4、5、6、7、9 |
| 8 模組職責 | 2～10 |
| 9 主要流程 | 10、13、18、20、21、22 |
| 10 編輯器細節 | 13～19 |
| 11 介面 | 11、12、23 |
| 12 錯誤處理 | 2、5、10、13、19、23 |
| 13 測試與品質 | 1、24 與各任務 |
| 14 部署 | 1（CI、vercel.json） |
