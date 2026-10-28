# 筆記 App v2 第 2 階段「匯入匯出」實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重點：知識庫可匯出成一般 Markdown ZIP 並原樣匯回、Chrome / Edge 可自動鏡像 `.md` 到資料夾、可從備份還原，並新增可放任意檔案的檔案區塊。次要：v1 匯出的 ZIP 能匯入（只求能搬，Task 10 刻意做小）。

**Architecture:** 新增純 TypeScript 的 `core/markdown`（ProseMirror JSON ↔ Markdown）與 `core/transfer`（匯出、匯入、從備份還原、v1 ZIP 轉換），所有來源先轉成同一種「檔案清單」再走同一條匯入管線。寫入 Yjs 文件需要編輯器 schema，因此 `core/transfer` 透過注入的 `DocIO` 讀寫筆記內容，實作放在 `app/` 層。鏡像 `core/mirror` 掛在索引完成事件後、閒置時間寫檔，以 Web Locks 保證單一寫入分頁。

**Tech Stack:** 沿用第 1 階段（Vite、React 19、TypeScript strict、Tiptap 3、Yjs、Dexie、markdown-it、Vitest、Playwright），新增 **fflate**（ZIP）。File System Access API / OPFS 為瀏覽器內建。

**Spec:** `docs/superpowers/specs/2026-10-28-notes-v2-phase2-design.md`（並沿用 `2026-10-21-notes-v2-phase1-design.md`）

## Global Constraints

- 第 1 階段計畫的 Global Constraints 全部沿用（`core/`、`adapters/` 不 import React / `features/` / `ui/`；檔案約 300 行即拆；介面文字繁體中文；組字中不攔鍵；E2E 在 Chromium 與 WebKit 皆須通過；合併 `main`、刪除資料須先取得使用者同意）
- 新套件只有 `fflate`，鎖定安裝時的確切版本
- `src/core/markdown/**`、`src/core/transfer/**`、`src/core/mirror/**` 不得使用 `document`、`window`、`DOMParser`、`Image`（ESLint `no-restricted-globals` 強制），必須能在 Worker 執行
- 單一附件上限 **104,857,600 bytes**（100 MB）；SVG 不收為圖片
- 重名後綴 `" (2)"`、`" (3)"`…（沿用 `dedupeTitle`）
- 檔名：移除 `/ \ : * ? " < > |` 與控制字元，去結尾 `.` 與空白，Windows 保留名（`CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9`，不分大小寫）後加 `_`，上限 **120 UTF-8 位元組**（不得切斷多位元組字元），空標題 → `未命名`
- 固定名稱：附件資料夾 `附件/`、manifest `.notes-v2.json`、鏡像垃圾桶 `.垃圾桶/`、匯入資料夾 `匯入 YYYY-MM-DD`、外部修改保留檔 `標題 (外部修改 YYYY-MM-DD HHmm).md`、ZIP 檔名 `我的知識庫-YYYY-MM-DD.zip`（日期一律本地時間）
- `####` 以下標題 → H3；`==x==` → 螢光標記 `#FFF1A8`（`HIGHLIGHT_COLORS[0]`）
- 清單縮排：項目 / 待辦 2 格、編號 3 格
- 效能：匯出 1,000 篇（不含附件）< 5 s 且畫面不凍結；鏡像在停止輸入後 ≤ 3 s 寫入；打字期間（`isTyping()` 為真）不做任何檔案存取
- 往返：第 6 節所有格式 匯出 → 匯入 → 再匯出，兩次 `.md` 逐字相同；帶 manifest 時 ProseMirror JSON 相同
- v1 只支援匯入 v1 匯出的 ZIP；不讀 v1 的 IndexedDB、不自動遷移、啟動時不做任何 v1 相關的事

## Review Focus

1. **連結指向垃圾桶中的筆記**（匯出時那篇不會被匯出）→ 輸出 `[[該筆記標題]]`，不輸出空白或 id；匯回時找不到就保留原文。測試加在 Task 8
2. **Windows 存的 `.md`（CRLF、UTF-8 BOM）** → 匯入結果與 LF、無 BOM 版本相同，標題第一個字不會多出看不見的字元。測試加在 Task 4
3. **中文或 emoji 長標題超過 120 位元組** → 檔名在字元邊界截斷，不出現亂碼或 `\uFFFD`。測試加在 Task 2
4. **使用者自己壓的 ZIP 含 `__MACOSX/`、`.DS_Store`、`../x.md`、絕對路徑** → 前兩者略過；後兩者路徑正規化到 ZIP 根目錄內，絕不建出 `..` 資料夾。測試加在 Task 6
5. **兩篇標題清理後在同一資料夾撞名**（`a/b` 與 `ab`）→ 匯出成 `ab.md` 與 `ab (2).md`，兩邊的 `[[…]]` 連結匯回後各自指向正確的筆記（連結用的是標題，不是檔名）。測試加在 Task 8

---

## 檔案結構

```
src/
  core/
    blocks.ts                      BLOCK_TYPES（由 features/editor/blocks/block-id.ts 搬來並 re-export）、assignBlockIds（由 guide/pm-json 搬來）
    markdown/
      types.ts                     PMNode、PMMark、RefNode、FileEntry、ParseResult
      paths.ts                     檔名清理、路徑編碼、區塊錨點、hash
      serialize.ts                 PMNode → Markdown
      serialize-inline.ts          行內文字、標記、跳脫
      parse.ts                     Markdown → PMNode（markdown-it token 直轉）
      md-plugins.ts                ==螢光==、[[…]]、![[…]]、#標籤、- [ ]、> [!x]、<u>、<br>
      v1-dialect.ts                :::quote
      frontmatter.ts               YAML frontmatter 的 tags / created / updated
    transfer/
      types.ts                     DocIO、ImportSource、ImportPlan、ImportChoices、ImportReport、V2Manifest
      resolve.ts                   RefNode → noteLink / media / 純文字
      export.ts                    知識庫 → FileEntry 串流 + manifest
      import-plan.ts               來源 → 預覽（不寫入）
      import-apply.ts              預覽 + 使用者選擇 → 寫入（可續傳）
      v1-zip.ts                    v1 ZIP → ImportSource
      restore.ts                   從備份還原（取代 / 合併）
      transfer-client.ts           Worker 包裝（無 Worker 時同步執行）
    mirror/
      mirror.ts                    排程、比對、寫入、外部修改保留、`.垃圾桶/`
      mirror-state.ts              meta.mirror 讀寫
  adapters/
    zip/zip.ts                     fflate 串流寫、讀（含路徑清理）
    fs/types.ts                    Dir 介面
    fs/handle-dir.ts               FileSystemDirectoryHandle 實作（本機資料夾與 OPFS 共用）
    fs/memory-dir.ts               記憶體實作（單元測試）
    fs/permission.ts               queryPermission / requestPermission 包裝
  app/
    doc-io.ts                      DocIO 實作（schema 來自編輯器 extensions）
    transfer-services.ts           組裝匯出 / 匯入 / 鏡像，加進 AppServices
  workers/
    transfer.worker.ts             serialize / parse 批次
  features/
    editor/blocks/media.tsx        kind 'file'
    editor/media/add-media.ts      addAttachmentFile（任意類型）
    editor/menus/slash-items.ts    「檔案」
    editor/paste/markdown-paste.ts 改用 parse.ts
    transfer/ExportDialog.tsx
    transfer/ImportDialog.tsx      選檔 → 預覽 → 選擇 → 進度 → 報告
    transfer/ImportReportView.tsx  匯入報告
    transfer/MirrorSection.tsx
    transfer/MirrorPausedChip.tsx  側欄底部「資料夾同步已暫停 · 繼續」
    transfer/RestoreDialog.tsx
    settings/DataSection.tsx       依規格第 10 節排列
    sidebar/RowMenu.tsx            「匯出為 Markdown」
```

---

### Task 1: 共用區塊常數搬到 core，`core/markdown` 型別與 lint 規則

**Files:**
- Create: `src/core/blocks.ts`, `src/core/markdown/types.ts`
- Modify: `src/features/editor/blocks/block-id.ts`（改為 re-export）, `src/features/guide/pm-json.ts`（`assignBlockIds` 改從 core re-export）, `eslint.config.js`, `package.json`（加 fflate）
- Test: `src/core/blocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // core/blocks.ts
  export const BLOCK_TYPES: readonly string[]
  export function assignBlockIds(doc: PMNode, types?: readonly string[], gen?: () => string): PMNode
  // core/markdown/types.ts
  export type PMMark = { type: string; attrs?: Record<string, unknown> }
  export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; marks?: PMMark[]; text?: string }
  /** Placeholder emitted by parse(), replaced by resolveRefs(); never stored. */
  export type RefNode = { type: 'wikiRef' | 'embedRef'; attrs: { target: string; heading: string | null; anchor: string | null; alias: string | null; width: number | null; raw: string } }
  export type FileEntry = { path: string; text?: string; blob?: Blob; mtime?: number }
  export type ParseResult = { doc: PMNode; tags: string[]; created: number | null; updated: number | null; lossy: string[] }
  ```

- [ ] **Step 1:** 測試：`assignBlockIds` 為缺 id 的 BLOCK_TYPES 節點補 id、保留已有 id、重複 id 改新值（把 guide 現有行為寫成測試）
- [ ] **Step 2:** 跑 `npx vitest run src/core/blocks.test.ts`，預期 FAIL（模組不存在）
- [ ] **Step 3:** 搬移程式碼；舊路徑 re-export 保持相容；`eslint.config.js` 對 `src/core/markdown/**`、`src/core/transfer/**`、`src/core/mirror/**` 加 `no-restricted-globals: ['error', 'document', 'window', 'DOMParser', 'Image']`；`npm i -E fflate`
- [ ] **Step 4:** `npm run typecheck && npm run lint && npx vitest run src/core src/features/guide`，全過
- [ ] **Step 5:** Commit `refactor: move block ids to core, add markdown types and fflate`

---

### Task 2: `paths.ts`

**Files:** Create `src/core/markdown/paths.ts`；Test `src/core/markdown/paths.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function safeFileName(title: string): string            // 規則見 Global Constraints，不含副檔名
  export function uniqueName(name: string, taken: Set<string>): string   // 比對不分大小寫，撞名加 " (2)"
  export function noteFilePath(folderPath: string[], title: string, taken: Set<string>): string  // 'A/B/標題.md'，taken 為小寫完整路徑
  export function encodeLinkPath(path: string): string   // 只編碼 % 空白 ( ) < > # ? [ ]
  export function decodeLinkPath(s: string): string      // decodeURIComponent，失敗回原字串
  export function blockAnchor(blockId: string): string   // 非 [A-Za-z0-9-] 換成 '-'
  export function normalizeZipPath(p: string): string | null  // '\\'→'/'、去開頭 '/'、去 '.'、'..' 不上溯；__MACOSX/、.DS_Store、Thumbs.db → null
  export function hashText(s: string): string            // cyrb53，16 位 hex
  export function localDate(t: number): string          // 'YYYY-MM-DD'
  export function localStamp(t: number): string         // 'YYYY-MM-DD HHmm'
  ```

- [ ] **Step 1:** 測試（`describe('paths')`）：
  ```ts
  expect(safeFileName('a/b:c*?')).toBe('abc')
  expect(safeFileName('  報告.  ')).toBe('報告')
  expect(safeFileName('con')).toBe('con_')
  expect(safeFileName('')).toBe('未命名')
  const long = '測'.repeat(50) // 150 bytes
  expect(new TextEncoder().encode(safeFileName(long)).length).toBeLessThanOrEqual(120)
  expect(safeFileName(long)).toBe('測'.repeat(40))
  expect(safeFileName('😀'.repeat(31))).toBe('😀'.repeat(30))      // Review Focus 3
  expect(uniqueName('A', new Set(['a']))).toBe('A (2)')
  expect(noteFilePath(['資料夾'], 'x/y', new Set())).toBe('資料夾/xy.md')
  expect(encodeLinkPath('附件/a b(1).png')).toBe('附件/a%20b%281%29.png')
  expect(decodeLinkPath('%E0%A4%A')).toBe('%E0%A4%A')
  expect(blockAnchor('aB_3-x')).toBe('aB-3-x')
  expect(normalizeZipPath('../../x.md')).toBe('x.md')
  expect(normalizeZipPath('/a/./b.md')).toBe('a/b.md')
  expect(normalizeZipPath('__MACOSX/a.md')).toBeNull()
  expect(normalizeZipPath('a/.DS_Store')).toBeNull()
  ```
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作（截斷以 `Array.from(str)` 逐字累加位元組）
- [ ] **Step 4:** 跑測試，預期 PASS
- [ ] **Step 5:** Commit `feat(markdown): file name and path rules`

---

### Task 3: `serialize.ts`（區塊 → Markdown）

**Files:** Create `src/core/markdown/serialize.ts`, `src/core/markdown/serialize-inline.ts`；Test `src/core/markdown/serialize.test.ts`

**Interfaces:**
- Consumes: Task 1 型別、Task 2 `blockAnchor` `encodeLinkPath`
- Produces:
  ```ts
  export type SerializeContext = {
    noteTitle(noteId: string): string | null            // 垃圾桶中的筆記也回傳標題；只有完全不存在才 null → 輸出純文字「（已刪除的筆記）」
    headingText(noteId: string, blockId: string): string | null  // 目標區塊是標題時回傳其文字
    attachmentPath(attachmentId: string): string | null  // '附件/檔名'；null → 輸出「（找不到附件）」
    anchoredBlocks: Set<string>                          // 本篇中被任何區塊連結指到、需要在行尾加 ^錨點 的區塊 id
  }
  export function serializeNote(doc: PMNode, ctx: SerializeContext): string   // 結尾恰一個 '\n'；區塊之間空一行；清單項目之間不空行
  ```

規則即規格 6.2，另外決定：
- 區塊連結指向**標題**區塊 → `[[標題#標題文字]]`；其他區塊 → `[[標題#^錨點]]`，錨點加在目標區塊第一行行尾 ` ^錨點`
- 標記輸出順序固定：link 最外層，其次 bold、italic、strike、underline、highlight、code（`textStyle` 不輸出）
- 跳脫：純文字中會被 `parse` 解讀為語法的字元一律加 `\`（行首 `#` `>` `-` `+` `*` `數字.`、行內 `*` `_` `` ` `` `[` `]` `<`、`==`、`~~`、可成為標籤的 `#`、表格內 `|`）；正確性由 Task 4 的往返測試把關
- 表格儲存格裡的非段落內容（清單等）→ 每行文字以 `<br>` 連接
- 檔案區塊（Task 5 的 `kind: 'file'`）→ `[檔名](附件/檔名)`

- [ ] **Step 1:** 測試，每列一個 `it`，以 `pm-json` 建構輸入，比對完整輸出字串：標題 H1–H3、段落各種標記、底線 `<u>`、螢光 `==`、清單巢狀（編號 3 格縮排、alpha 仍輸出 `1.`）、待辦、引用、三種提示框、程式碼含語言、表格含 `<br>` 與 `|` 跳脫、圖片與影片 `![a.png](附件/a.png)`、檔案 `[a.pdf](附件/a.pdf)`、筆記連結、標題連結、區塊連結與錨點、標籤、分隔線、純文字 `1. 不是清單` → `1\. 不是清單`、`#不是標籤` → `\#不是標籤`
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** 跑測試，預期 PASS
- [ ] **Step 5:** Commit `feat(markdown): serialize blocks to Markdown`

---

### Task 4: `parse.ts`（Markdown → 區塊）與往返測試

**Files:** Create `src/core/markdown/parse.ts`, `md-plugins.ts`, `v1-dialect.ts`, `frontmatter.ts`；Test `src/core/markdown/parse.test.ts`, `src/core/markdown/roundtrip.test.ts`, fixture `src/core/markdown/__fixtures__/all-blocks.ts`

**Interfaces:**
- Consumes: Task 1 型別、Task 2 `decodeLinkPath`
- Produces:
  ```ts
  export function parseMarkdown(src: string, opts?: { dialect?: 'v1' }): ParseResult
  ```
  - 輸出的區塊**已有 id**（`assignBlockIds`）；行尾 ` ^錨點` 被移除，該區塊 id 設為錨點字串
  - `[[…]]` → 行內 `wikiRef`；`![[…]]`、`![](相對路徑)`、`[文字](相對路徑且非 .md)` → 行內 `embedRef`；`http(s):`、`mailto:` 連結仍是 link 標記
  - 規格第 5 節對照表全部實作；`dialect: 'v1'` 才啟用 `:::quote`
  - 先去 BOM、`\r\n` → `\n`
  - 數學 `$$…$$` → `codeBlock` 語言 `math`；`$…$` → 行內碼；註腳定義收集成文末「註腳」段落；不認得的 HTML、`~下標~`、`^上標^` 保留原文並把語法名稱加進 `lossy`

- [ ] **Step 1:** `parse.test.ts`：規格第 5 節每列一個 `it`，另含
  ```ts
  it('CRLF and BOM parse the same as LF', () => {           // Review Focus 2
    const lf = '# 標題\n\n- a\n- b\n'
    expect(parseMarkdown('\uFEFF' + lf.replace(/\n/g, '\r\n')).doc).toEqual(parseMarkdown(lf).doc)
  })
  it('keeps a trailing ^anchor as the block id', () => {
    const { doc } = parseMarkdown('文字 ^abc-1\n')
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { id: 'abc-1' } })
  })
  it('[[標題|別名]] keeps the alias on the ref', () => {
    expect(inlineAt(parseMarkdown('[[A|b]]').doc, 0)).toMatchObject({ type: 'wikiRef', attrs: { target: 'A', alias: 'b' } })
  })
  ```
  （id 比對時以 `stripIds()` 測試輔助函式去掉隨機 id）
- [ ] **Step 2:** `roundtrip.test.ts`：fixture 為一篇含 Task 3 所有格式（含需要跳脫的純文字）的 PMNode；以假 resolver（Task 7 前先用測試內的簡易版把 `wikiRef` / `embedRef` 換回原節點）驗證
  ```ts
  const md1 = serializeNote(fixture, ctx)
  const back = fakeResolve(parseMarkdown(md1).doc)
  expect(serializeNote(back, ctx)).toBe(md1)
  expect(stripIds(back)).toEqual(stripIds(withoutLossyAttrs(fixture)))  // 6.4 的屬性除外
  ```
- [ ] **Step 3:** 跑測試，預期 FAIL
- [ ] **Step 4:** 實作（markdown-it `html: false`，`<u>` 與 `<br>` 由 md-plugins 的行內規則處理；callout 由 blockquote token 開頭判斷）
- [ ] **Step 5:** 跑 `npx vitest run src/core/markdown`，全過
- [ ] **Step 6:** Commit `feat(markdown): parse Markdown to blocks with round-trip tests`

---

### Task 5: 檔案區塊與 `/` 選單「檔案」

**Files:**
- Modify: `src/features/editor/media/add-media.ts`, `src/features/editor/media/insert-files.ts`, `src/features/editor/blocks/media.tsx`, `src/features/editor/menus/slash-items.ts`, `src/features/editor/menus/SlashMenu.tsx`（圖示）, `src/features/sidebar/AttachmentsView.tsx`（Thumb 檔案圖示）, `src/ui/icons.tsx`（`FileIcon`、`Download`）, `src/features/editor/extensions.ts`（`pickFile` 指令）, `src/features/guide/guide-content.ts`
- Test: `src/features/editor/media/media.test.tsx`, `e2e/media.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MediaKind = 'image' | 'video' | 'file'
  export function mediaKind(mimeType: string): MediaKind        // 非圖片影片 → 'file'（不再回 null）
  export async function addMedia(file: File, deps): Promise<{ attachmentId: string; kind: MediaKind }>  // SVG 仍拒收；其他類型都收
  // editor command
  pickFile(): boolean   // 開檔案選擇（accept 不限），插入檔案區塊
  ```
- 檔案區塊外觀：一列，`FileIcon` + 檔名（截斷）+ 大小（`formatBytes`）+「下載」按鈕（`<a download={filename} href={blobUrl}>`）；不預覽、不可調寬度；已在垃圾桶 / 找不到的顯示沿用圖片影片的狀態列
- slash 項目：`{ id: 'file', label: '檔案', hint: '上傳任意檔案，提供下載', aliases: ['file', 'pdf', 'attach', 'dangan'] }`，排在「圖片或影片」之後
- `pickFiles` 的 `accept` 由參數決定：圖片影片 `'image/*,video/*'`、檔案不設

- [ ] **Step 1:** 測試：`mediaKind('application/pdf') === 'file'`；`addMedia` 收 PDF、拒 SVG、拒 > 100 MB；檔案區塊渲染出檔名、`2.0 KB`、`download` 屬性為檔名的連結；slash 篩選 `pdf` 出現「檔案」
- [ ] **Step 2:** 跑 `npx vitest run src/features/editor/media src/features/editor/menus`，預期 FAIL
- [ ] **Step 3:** 實作；功能導覽「圖片與附件」加一句「輸入 `/檔案` 可加入 PDF、Office 等任意檔案」
- [ ] **Step 4:** e2e：拖進一個 `.pdf` → 出現檔案區塊、點下載觸發 `download` 事件、附件面板列出；全部 vitest + `npx playwright test e2e/media.spec.ts e2e/guide-claims.spec.ts` 通過
- [ ] **Step 5:** Commit `feat(editor): file block for any attachment type`

---

### Task 6: ZIP 與資料夾介面卡

**Files:** Create `src/adapters/zip/zip.ts`, `src/adapters/fs/types.ts`, `handle-dir.ts`, `memory-dir.ts`, `permission.ts`；Test `src/adapters/zip/zip.test.ts`, `src/adapters/fs/dir-contract.ts`（共用契約）, `memory-dir.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // zip.ts
  export async function writeZip(entries: AsyncIterable<FileEntry>): Promise<Blob>   // fflate Zip 串流；entry 時間取 mtime
  export async function readZip(file: Blob): Promise<FileEntry[]>   // fflate Unzip 串流；.md / .json → text（UTF-8），其餘 → blob；路徑經 normalizeZipPath，null 者略過
  // fs/types.ts
  export type FileStat = { mtime: number; size: number }
  export interface Dir {
    stat(path: string): Promise<FileStat | null>
    read(path: string): Promise<{ data: Blob } & FileStat | null>
    write(path: string, data: Blob | string): Promise<FileStat>   // 自動建立中間資料夾
    remove(path: string): Promise<void>                           // 不存在時不報錯；順手刪除變空的上層資料夾
    list(): AsyncIterable<{ path: string } & FileStat>             // 遞迴、只列檔案
  }
  export function handleDir(root: FileSystemDirectoryHandle): Dir
  export function memoryDir(clock?: () => number): Dir & { files: Map<string, { data: string | Blob; mtime: number }> }
  // permission.ts
  export async function permissionOf(h: FileSystemHandle): Promise<'granted' | 'prompt' | 'denied'>   // 無 queryPermission（OPFS / WebKit）→ 'granted'
  export async function askPermission(h: FileSystemHandle): Promise<boolean>   // 須在使用者手勢內呼叫
  export const canPickDirectory: () => boolean   // 'showDirectoryPicker' in window
  ```

- [ ] **Step 1:** 測試：`writeZip` → `readZip` 往返（中文路徑、二進位 blob、空 `.md`）；手工以 fflate 做一個含 `__MACOSX/a.md`、`.DS_Store`、`../x.md`、`/abs/y.md` 的 ZIP → 讀出路徑為 `['x.md', 'abs/y.md']`（Review Focus 4）；`dir-contract.ts` 對 `memoryDir` 跑 write / stat / read / remove（含刪空資料夾）/ list
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** 跑測試，預期 PASS（`handleDir` 由 Task 11 的 OPFS e2e 跑同一份契約）
- [ ] **Step 5:** Commit `feat(adapters): streaming zip and directory adapters`

---

### Task 7: 匯入管線核心（解析參照、預覽、寫入、續傳）

**Files:**
- Create: `src/core/transfer/types.ts`, `resolve.ts`, `import-plan.ts`, `import-apply.ts`, `src/app/doc-io.ts`
- Modify: `src/core/vault/vault.ts`, `src/core/vault/types.ts`（`VaultErrorCode` 加 `'exists'`）
- Test: `src/core/transfer/resolve.test.ts`, `import.test.ts`, `src/core/vault/vault.test.ts`, `src/app/doc-io.test.ts`

**決策（規格 4.3 / 7.2 的「兩輪」在此具體化）：** 先在記憶體解析全部檔案、預先產生每篇的 noteId，再一次解析所有參照，最後逐篇「建立筆記 + 寫入完整內容」。筆記出現時內容已完整，不需要回頭修改使用者可能已開啟的文件。

**Interfaces:**
- Consumes: Task 4 `parseMarkdown`、Task 2 `uniqueName` `localDate` `hashText`、Task 5 `mediaKind`
- Produces:
  ```ts
  // vault.ts 新增選擇性參數（id 已存在 → VaultError('exists')）
  createNote(i: { id?: string; title?: string; folderId?: string | null; index?: number; createdAt?: number; updatedAt?: number }): NoteMeta
  createFolder(i: { id?: string; name: string; parentId: string | null; index?: number }): FolderMeta
  addAttachment(a: { id?: string; createdAt?: number; filename: string; mimeType: string; size: number }): AttachmentMeta

  // transfer/types.ts
  export interface DocIO {
    write(noteId: string, doc: PMNode): Promise<void>     // 新筆記：schema 驗證 → Yjs update → appendUpdate → 標記 dirty
    replace(noteId: string, doc: PMNode): Promise<void>   // 既有筆記：notes.acquire → 單一 transact 清空再填入 → release
    read(noteId: string): Promise<PMNode>                 // 已開啟用快取文件，否則 loadDoc
  }
  export type ImportSource = {
    kind: 'markdown' | 'v2' | 'v1'
    entries: FileEntry[]                       // 已過 normalizeZipPath
    manifest?: V2Manifest                      // 來自 .notes-v2.json
    noteMeta?: Map<string, { createdAt: number; updatedAt: number }>   // 以 path 為鍵（v1 ZIP 用）
    emptyFolders?: string[]                    // 'a/b'
  }
  export type ImportPlan = {
    jobId: string                              // hashText(所有 path + 內容 hash)，續傳用
    notes: { path: string; noteId: string; title: string; folderPath: string[]; renamedFrom?: string; existing?: boolean }[]
    folders: string[][]
    attachments: { path: string; attachmentId: string; size: number; skipped?: 'too-large' }[]
    unresolved: { notePath: string; raw: string }[]
    aliased: { notePath: string; raw: string }[]
    existingCount: number                      // 帶 manifest 且 noteId 已在知識庫者
  }
  export type ImportChoices = {
    destination: { kind: 'new-dated' } | { kind: 'folder'; folderId: string | null }
    onExisting: 'overwrite' | 'copy' | null    // existingCount > 0 時必填
  }
  export type ImportReport = {
    notes: number; folders: number; attachments: number
    renamed: { from: string; to: string; noteId: string }[]
    unresolved: { noteId: string; raw: string }[]
    aliased: { noteId: string; raw: string }[]
    lossy: { noteId: string; syntax: string }[]
    skipped: { path: string; reason: string }[]
  }
  export type V2Manifest = {
    format: 'notes-v2'; version: 1; exportedAt: number
    folders: { id: string; path: string; order: number }[]
    notes: { id: string; path: string; createdAt: number; updatedAt: number; mdHash: string; blockIds: string[]; doc?: PMNode }[]
    attachments: { id: string; path: string; filename: string; mimeType: string; createdAt: number }[]
  }
  export type ImportDeps = { vault: Vault; storage: StorageAdapter; db: NotesDb; docs: DocIO; parse(files: { path: string; text: string; dialect?: 'v1' }[]): Promise<ParseResult[]> }
  export async function planImport(src: ImportSource, deps: ImportDeps): Promise<ImportPlan & { parsed: Map<string, ParseResult> }>
  export async function applyImport(plan: Awaited<ReturnType<typeof planImport>>, src: ImportSource, choices: ImportChoices, deps: ImportDeps, onProgress?: (done: number, total: number) => void): Promise<ImportReport>

  // resolve.ts
  export type Resolver = {
    note(title: string): string | null
    heading(noteId: string, text: string): string | null
    block(noteId: string, anchor: string): string | null
    attachment(target: string, fromPath: string): { id: string; kind: MediaKind } | null
  }
  export function resolveRefs(doc: PMNode, r: Resolver): { doc: PMNode; unresolved: string[]; aliased: string[]; missing: string[] }
  ```
- 規則：
  - 標題 = 檔名去 `.md`；與現有或同批筆記重名 → `uniqueName`，記入 `renamed`
  - 連結找筆記：先同批、後現有；`embedRef` 單獨成段 → 換成 media 區塊；與文字同段 → 該段在此切開，media 區塊插在中間；找不到 → 「（找不到附件：x）」純文字
  - `wikiRef` 找不到 → 原文字 `raw`；有別名 → 記入 `aliased`，連結仍指向筆記（別名捨棄）
  - 帶 manifest：note 的 `mdHash` 與 `.md` 相同且有 `doc` → 直接用 `doc`；`mdHash` 相同但無 `doc` → 依序套用 `blockIds`；否則照一般解析。資料夾、附件、筆記沿用 manifest 的 id；id 與知識庫衝突依 `onExisting`：`overwrite` → 先 `docs.read` 現有內容建一篇 `「標題（覆蓋前）」` 筆記並移到垃圾桶，再 `docs.replace`、還原（若在垃圾桶）、移到備份中的位置；`copy` → 換新 id、標題 `uniqueName`
  - 附件：一次讀一個 blob；> 100 MB → `skipped`；SVG 與非圖片影片 → 檔案區塊
  - frontmatter `tags` → 文末段落加標籤；`created` / `updated` → 筆記時間
  - 續傳：`meta.importJob = { jobId, done: string[] /*source path*/, noteIds: Record<path, id>, attachmentIds: Record<path, id> }`，每篇寫完更新；`applyImport` 開始時若 `jobId` 相同就略過 `done`；結束時刪除 `importJob`
  - 全部寫完後 `indexer.catchUp()`（呼叫端負責）

- [ ] **Step 1:** `vault.test.ts`：指定 id 建立、id 重複丟 `exists`、指定時間保留
- [ ] **Step 2:** `resolve.test.ts`：筆記 / 標題 / 區塊 / 別名 / 找不到 / 嵌入成段與段中切開
- [ ] **Step 3:** `import.test.ts`（MemoryStorage + fake-indexeddb + `memoryDocIO` 測試替身）：
  - 三篇互相連結 + 子資料夾 + 一張圖 → 筆記、資料夾、連結、media 正確；目的地「匯入 2026-10-28」（`vi.setSystemTime`）
  - 與現有筆記同名 → `(2)` 並記入報告
  - 帶 manifest 匯入到空知識庫 → id 與 `doc` 完全相同
  - 帶 manifest 且 id 已存在：`copy` → 新 id、`(2)`；`overwrite` → 同 id 內容換新、垃圾桶多一篇「（覆蓋前）」且內容為舊版；`onExisting: null` 時丟錯
  - 第 2 篇寫入時讓 `docs.write` 丟錯 → 再跑一次 `applyImport` → 結果與一次完成相同、沒有重複筆記
  - 101 MB 附件 → `skipped`，筆記仍匯入
- [ ] **Step 4:** `doc-io.test.ts`：`write` 後以 `NoteDocCache.acquire` 讀出相同 JSON；`replace` 一篇已開啟的文件 → 開啟中的 Y.Doc 立即反映
- [ ] **Step 5:** 跑測試，預期 FAIL
- [ ] **Step 6:** 實作（`DocIO` 由 `features/guide/guide.ts` 的寫入流程抽出；`guide.ts` 改用它）
- [ ] **Step 7:** `npx vitest run src/core src/app src/features/guide`，全過
- [ ] **Step 8:** Commit `feat(transfer): shared import pipeline with preview, overwrite-or-copy and resume`

---

### Task 8: 匯出與 Worker

**Files:** Create `src/core/transfer/export.ts`, `transfer-client.ts`, `src/workers/transfer.worker.ts`；Test `src/core/transfer/export.test.ts`, `src/core/transfer/full-roundtrip.test.ts`

**Interfaces:**
- Consumes: Task 3 `serializeNote`、Task 6 `writeZip`、Task 7 `DocIO.read` `V2Manifest` `applyImport`
- Produces:
  ```ts
  export type ExportScope = { kind: 'vault' } | { kind: 'folder'; folderId: string } | { kind: 'note'; noteId: string }
  export type ExportOptions = { includeUnusedAttachments: boolean; includeDocs: boolean /* manifest 是否含完整 doc；ZIP true、鏡像 false */ }
  export function exportEntries(scope: ExportScope, opts: ExportOptions, deps: { vault: Vault; storage: StorageAdapter; db: NotesDb; docs: DocIO; serialize: TransferClient['serialize'] }): AsyncIterable<FileEntry>   // 最後一個 entry 是 .notes-v2.json
  export async function exportZip(scope: ExportScope, opts: ExportOptions, deps): Promise<{ blob: Blob; fileName: string }>   // 單篇 → 單一 .md Blob、檔名「標題.md」
  export type TransferClient = {
    serialize(items: { doc: PMNode; ctx: SerializableContext }[]): Promise<string[]>
    parse(files: { path: string; text: string; dialect?: 'v1' }[]): Promise<ParseResult[]>
  }
  export function createTransferClient(): TransferClient   // 有 Worker 用 Worker（每批 50 篇），否則同步執行
  ```
  `SerializableContext` = `SerializeContext` 的純資料版（`titles: Record<id,string>`、`headings: Record<'noteId#blockId', string>`、`attachments: Record<id,path>`、`anchored: string[]`）；Worker 內再包成函式
- 規則：垃圾桶內的筆記與附件不匯出；`anchoredBlocks` 由 `db.links` 中 `blockId` 非空且非標題者計算；附件檔名 `uniqueName`；主執行緒每讀 20 篇 `await` 一次 `idle()`

- [ ] **Step 1:** `export.test.ts`：路徑結構符合規格 6.3；垃圾桶不出現；未使用附件預設不出、`includeUnusedAttachments` 才出；同名附件 `(2)`；manifest 欄位齊全；連到垃圾桶筆記的連結輸出 `[[該標題]]`（Review Focus 1）；`a/b` 與 `ab` 兩篇匯出為 `ab.md`、`ab (2).md`（Review Focus 5）
- [ ] **Step 2:** `full-roundtrip.test.ts`：以 fixture 建知識庫 → `exportEntries` → 匯入到**新的空知識庫** → 再匯出，兩次每個 `.md` 逐字相同；帶 manifest 時每篇 `docs.read` JSON 相同；拿掉 manifest 再匯入 → `.md` 仍逐字相同；`a/b`、`ab` 兩篇互相連結，匯回後連結各自指向對的筆記（Review Focus 5）
- [ ] **Step 3:** 跑測試，預期 FAIL
- [ ] **Step 4:** 實作
- [ ] **Step 5:** 跑測試，預期 PASS
- [ ] **Step 6:** Commit `feat(transfer): export to Markdown ZIP via worker`

---

### Task 9: 匯入匯出介面、貼上改用 `parse.ts`

**Files:**
- Create: `src/features/transfer/ExportDialog.tsx`, `ImportDialog.tsx`, `ImportReportView.tsx`, `src/app/transfer-services.ts`
- Modify: `src/app/bootstrap.ts`（`AppServices.transfer`）, `src/features/settings/DataSection.tsx`, `src/features/sidebar/RowMenu.tsx`, `src/features/sidebar/Sidebar.tsx`（拖檔）, `src/features/editor/paste/markdown-paste.ts`
- Test: `src/features/transfer/transfer-ui.test.tsx`, `src/features/editor/paste/paste.test.ts`, `e2e/transfer.spec.ts`

**Interfaces:**
- Consumes: Task 7、Task 8
- Produces:
  ```ts
  // AppServices 新增
  transfer: {
    client: TransferClient
    docs: DocIO
    exportZip(scope: ExportScope, opts: ExportOptions): Promise<{ blob: Blob; fileName: string }>
    sourceFromFiles(files: File[]): Promise<ImportSource>   // .zip（有 .notes-v2.json → 'v2'；有 manifest.json 且 format markdown-vault-zip → Task 10 的 `v1ZipToSource`）／多個 .md ／ webkitdirectory 資料夾
    plan(src: ImportSource): ReturnType<typeof planImport>
    apply(plan, src, choices, onProgress): Promise<ImportReport>
  }
  ```
- 匯入對話框步驟：選檔 → 預覽（篇數、資料夾數、附件數、改名清單、找不到的連結）→ 目的地（預設「建立『匯入 YYYY-MM-DD』資料夾」，可改選現有資料夾或根目錄）→ 若 `existingCount > 0`：顯示「備份中有 N 篇筆記已存在」與兩個單選「覆蓋（目前版本會放進垃圾桶）」「建立副本」，**都不預選**，未選時「匯入」按鈕停用 → 進度條 → 報告
- 匯出對話框：「包含未使用的附件」核取方塊、說明一次已知損失（規格 6.4 原文）→ 下載
- 側欄右鍵「匯出為 Markdown」：筆記 → `.md`、資料夾 → ZIP，不開對話框
- 拖進側欄的 `.md` / `.zip` / 資料夾 → 開匯入對話框並帶入
- 貼上：`markdownToHtml` 改為 `parseMarkdown` → `resolveRefs`（`note()` 查現有標題，找不到留原文；`attachment()` 一律 null）→ `insertContent(json)`；`looksLikeMarkdown` 加 `[[`、`==` 訊號；移除 DOMPurify 依賴（若其他地方未使用）
- 匯入中：`meta.importJob` 存在時，資料分頁顯示「上次匯入未完成（已匯入 N 篇）· 重新選擇相同檔案即可繼續」

- [ ] **Step 1:** 元件測試：預覽數字正確；`existingCount > 0` 時兩個選項都未選、按鈕停用，選了才可按；匯入後報告列出改名與未解析連結且可點擊開啟筆記；匯出對話框按下載呼叫 `exportZip`
- [ ] **Step 2:** 貼上測試：既有 `markdown-paste` 測試全數照舊通過；新增 `[[現有筆記]]` 貼上變成筆記連結、`==x==` 變螢光
- [ ] **Step 3:** 跑測試，預期 FAIL
- [ ] **Step 4:** 實作
- [ ] **Step 5:** e2e `transfer.spec.ts`：建三篇（含連結、圖片）→ 設定匯出 ZIP（攔下 `download`）→ 清空資料庫重新整理 → 匯入該 ZIP → 筆記、資料夾、連結可點、圖片顯示；再匯入一次 → 出現覆蓋 / 副本選擇
- [ ] **Step 6:** `npm test && npx playwright test e2e/transfer.spec.ts e2e/editor.spec.ts`，全過
- [ ] **Step 7:** Commit `feat(transfer): import and export UI; paste uses the shared parser`

---

### Task 10: v1 ZIP 匯入（次要，刻意做小）

**Files:** Create `src/core/transfer/v1-zip.ts`；Modify `src/app/transfer-services.ts`（`sourceFromFiles` 判斷）；Test `src/core/transfer/v1-zip.test.ts`

v1 格式對照：`git fetch origin v1-archive && git show FETCH_HEAD:lib/obsidian/storage.ts`（`format: "markdown-vault-zip"`、`version: 3`、`notes/{id}.md`、`media/{id}/{檔名}`、manifest 的 `notes[].title/folder/createdAt/updatedAt`、`customFolders`）與 `lib/obsidian/media.ts`（`![[id|名稱]]`、舊版 `![[檔名]]`）。

**Interfaces:**
- Consumes: Task 6 `readZip`、Task 7 `ImportSource`
- Produces:
  ```ts
  export function isV1Zip(entries: FileEntry[]): boolean          // 有 manifest.json 且 format === 'markdown-vault-zip'
  export function v1ZipToSource(entries: FileEntry[]): ImportSource   // kind 'v1'；版本不是 3 → 丟 Error('不支援此 v1 備份版本')
  ```
- 轉換：每篇 → `folder/標題.md`（`text` 為 v1 內容）；`media/{id}/{檔名}` → `附件/檔名`（撞名 `uniqueName`）；內文 `![[id|名稱]]` 與 `![[檔名]]` 改寫成 `![[附件/檔名]]`；`customFolders` → `emptyFolders`；時間由 ISO 字串轉 `noteMeta`。其餘（同名、壞連結、別名、檔案區塊、100 MB）全部交給 Task 7 既有規則
- UI 不另做：匯入對話框選到 v1 ZIP 時照常預覽、選目的地、匯入、看報告

- [ ] **Step 1:** 測試：以 fflate 依 v1 格式產生小 ZIP（2 篇在子資料夾、1 個空的自訂資料夾、1 張圖用 `![[id|名稱]]`、1 個 PDF、一篇含 `:::quote`、一個 `[[另一篇]]`）→ `v1ZipToSource` → `planImport` + `applyImport` → 篇數、資料夾含空資料夾、時間沿用、圖片 media、PDF 檔案區塊、引用、連結都正確；`version: 2` 丟錯
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** 跑測試，預期 PASS
- [ ] **Step 5:** Commit `feat(transfer): import v1 backup ZIP through the shared pipeline`

---

### Task 11: 自動鏡像 `.md`

**Files:**
- Create: `src/core/mirror/mirror.ts`, `mirror-state.ts`, `src/features/transfer/MirrorSection.tsx`, `MirrorPausedChip.tsx`
- Modify: `src/core/indexer/indexer.ts`（`onIndexed`）, `src/app/transfer-services.ts`, `src/features/sidebar/Sidebar.tsx`（底部 chip）, `src/features/settings/DataSection.tsx`
- Test: `src/core/mirror/mirror.test.ts`, `e2e/mirror.spec.ts`

**Interfaces:**
- Consumes: Task 6 `Dir` `permissionOf` `askPermission`、Task 8 `exportEntries` 的路徑與內容規則（同一套 `serializeNote` + `noteFilePath`）
- Produces:
  ```ts
  // indexer.ts
  onIndexed(cb: (noteId: string) => void): () => void
  // mirror-state.ts
  export type MirrorState = {
    status: 'off' | 'active' | 'paused-permission' | 'missing-folder'
    handle?: FileSystemDirectoryHandle
    files: Record<string /*noteId*/, { path: string; hash: string; mtime: number; size: number; trashed: boolean }>
    attachments: Record<string, { path: string; mtime: number; size: number }>
    failed: Record<string, string>         // noteId → 錯誤訊息（重試 3 次後）
    lastWriteAt?: number
  }
  export type MirrorConflict = { noteId: string; keptAs: string; at: number }   // meta.mirrorConflicts
  // mirror.ts
  export class Mirror {
    constructor(deps: { vault: Vault; db: NotesDb; docs: DocIO; indexer: Indexer; storage: StorageAdapter; isTyping(): boolean; idle(): Promise<void>; locks?: LockManager; now?: () => number })
    start(dir: Dir): Promise<void>         // 取得 Web Lock 'notes-v2-mirror' 後才開始寫；拿不到就等
    stop(): void
    reconcile(): Promise<void>             // 啟動與恢復時：對每篇比對 hash 與路徑，補寫 / 搬移 / 刪除
    readonly status: MirrorState['status']
    subscribe(cb: () => void): () => void
  }
  ```
- 規則：
  - 觸發：`indexer.onIndexed` → 排入佇列；`vault.observe` → 重新計算所有筆記期望路徑，路徑有變的排入；處理佇列前 `await idle()`，`isTyping()` 為真就延後；目標：停止輸入後 ≤ 3 s 寫完
  - 寫入前外部修改檢查：`dir.stat(path)` 與記錄的 `mtime` / `size` 不同 → `read` 舊內容寫到 `標題 (外部修改 YYYY-MM-DD HHmm).md`，記一筆 `MirrorConflict`，再寫 App 版本
  - 改名 / 移動：寫新路徑後 `remove` 舊路徑（舊路徑同樣先做外部修改檢查）
  - 移到垃圾桶 → 移到 `.垃圾桶/原路徑`；還原 → 移回（撞名 `uniqueName`）；永久刪除 → 刪 `.垃圾桶/` 內檔案（外部改過的不刪，改名保留）
  - 附件：第一次被活筆記引用時寫 `附件/檔名`；與 ZIP 相同命名
  - `.notes-v2.json`（不含 `doc`）在任何變更後最多每 10 s 寫一次
  - 錯誤：權限非 `granted` → `paused-permission`；`NotFoundError` → `missing-folder`；其他寫入錯誤重試 3 次（2 s、5 s、15 s）後記入 `failed`
- 介面：
  - 資料分頁「同步到資料夾」：不支援 → 「此瀏覽器無法自動同步到資料夾，請使用匯出」；支援 → 狀態「已同步 128 篇 · 2 分鐘前」、「選擇資料夾」、「停止同步」、失敗清單、外部修改清單
  - `paused-permission` 時側欄底部「已儲存在此裝置」旁出現「資料夾同步已暫停 · 繼續」，點擊呼叫 `askPermission` 後 `reconcile()`

- [ ] **Step 1:** `mirror.test.ts`（`memoryDir`、假時鐘、假 locks）：新筆記寫檔且內容等於 `serializeNote` 結果；打字中不寫、停止後寫；改名 → 新檔出現舊檔消失；移動資料夾同；外部修改後再寫 → 保留檔出現、內容為外部版本；垃圾桶 / 還原 / 永久刪除對應 `.垃圾桶/`；附件只在被引用時寫；寫入錯誤重試 3 次後記入 `failed`；第二個 `Mirror` 實例在第一個持有 lock 時不寫任何檔
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** e2e `mirror.spec.ts`（只在 Chromium 跑；WebKit 另一個 test 檢查「此瀏覽器無法自動同步」字樣）：`addInitScript` 把 `showDirectoryPicker` 換成 `() => navigator.storage.getDirectory()` → 開啟同步 → 打字停 3 s 後 OPFS 有對應 `.md`；並在頁面內對 OPFS 跑 Task 6 的 `dir-contract`；開兩個分頁同時打字 → 只有一個分頁寫入（以 OPFS 檔案寫入次數判斷）
- [ ] **Step 5:** `npm test && npx playwright test e2e/mirror.spec.ts`，全過
- [ ] **Step 6:** Commit `feat(mirror): one-way .md mirror with external-edit protection`

---

### Task 12: 從備份還原

**Files:** Create `src/core/transfer/restore.ts`, `src/features/transfer/RestoreDialog.tsx`；Modify `src/features/settings/DataSection.tsx`；Test `src/core/transfer/restore.test.ts`, `src/features/transfer/restore-ui.test.tsx`

**Interfaces:**
- Consumes: Task 7 `planImport` `applyImport`、Task 8 `exportZip`、Task 6 `handleDir`（從鏡像資料夾讀）
- Produces:
  ```ts
  export async function sourceFromDir(dir: Dir): Promise<ImportSource>   // 鏡像資料夾，略過 .垃圾桶/
  export async function restoreBackup(src: ImportSource, mode: 'replace' | 'merge', choices: Pick<ImportChoices, 'onExisting'>, deps: ImportDeps): Promise<ImportReport>
  ```
- `replace`：讓知識庫等於備份 —— 備份中的每篇依 manifest id 覆蓋或建立（不另建「覆蓋前」副本，因為事前已下載整份 ZIP）、在垃圾桶的還原、移到備份位置；備份中沒有的筆記與資料夾**移到垃圾桶**（30 天內可救回）
- `merge`：等同一般匯入，目的地為根目錄、保留資料夾結構；`existingCount > 0` 時同 Task 9 要求選擇
- 對話框：知識庫非空時先自動執行 `exportZip({ kind: 'vault' })` 並下載，顯示「已先下載目前知識庫的備份」後才出現「取代」「合併」；「取代」再確認一次並寫明「目前不在備份中的筆記會移到垃圾桶」

- [ ] **Step 1:** 測試：`replace` 後活筆記集合與備份相同、多出的在垃圾桶；`merge` 保留雙方；知識庫非空時對話框先呼叫 `exportZip`，未完成前不顯示選項
- [ ] **Step 2:** 跑測試，預期 FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** 跑測試，預期 PASS
- [ ] **Step 5:** Commit `feat(transfer): restore from backup ZIP or mirror folder`

---

### Task 13: 整合驗收

**Files:** Modify `src/features/settings/DataSection.tsx`（最終排列）, `src/features/guide/guide-content.ts`, `src/bench/bench-entry.ts`, `scripts/bench.ts`；Test `e2e/guide-claims.spec.ts`, `e2e/settings.spec.ts`

- [ ] **Step 1:** 資料分頁依規格第 10 節順序：儲存空間、匯出、匯入、同步到資料夾、從備份還原、維護；`settings.spec.ts` 檢查順序與標題
- [ ] **Step 2:** 功能導覽：「之後會有」移除第 2 階段那行；新增「匯入匯出」說明（匯出 ZIP、匯入、同步到資料夾、從備份還原、檔案區塊）；`guide-claims.spec.ts` 逐句驗證
- [ ] **Step 3:** bench 加「匯出 1,000 篇」與「匯入 1,000 篇」；門檻：匯出 < 5,000 ms，兩者執行期間主執行緒最長任務 < 200 ms
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm test && npx playwright test && npm run bench`，全過；bench 數值寫進 commit 訊息
- [ ] **Step 5:** 部署 Vercel 預覽；請使用者在 v1 匯出 ZIP、到預覽網址匯入試一次（規格 13 第 2 步）
- [ ] **Step 6:** Commit `chore: phase 2 acceptance — settings layout, guide, benchmarks`
- [ ] **Step 7:** **停在這裡**：合併 `v2` 進 `main` 前取得使用者同意（規格第 13 節）
