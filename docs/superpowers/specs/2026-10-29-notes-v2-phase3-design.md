# 筆記 App v2 — 第 3 階段「帳號與同步」設計規格

- 日期：2026-10-29
- 狀態：待審閱
- 依據：`2026-10-21-notes-v2-phase1-design.md` 第 2.3、2.4 節已定案決策；本文件把那兩節展開為可實作的設計
- 前置：第 1、2 階段已完成並合併（`main` @ `32a24cc`）

---

## 1. 範圍

**包含**：Email + 密碼註冊／登入、復原碼、裝置管理、端對端加密、同一使用者多裝置同步（Supabase 免費方案）、**同步單位為單篇筆記**（使用者自選哪些筆記同步，可隨時取消個別筆記的同步）。

**不包含**（延後至後續階段）：分享連結（第 4 階段，但資料模型預留欄位）、多人協作、付費、自架、多知識庫切換介面。

**關於選擇性同步的重要前提**：因為是端對端加密，Supabase 本來就看不到任何明文，所以「選哪些筆記同步」不是在解決伺服器端的隱私問題（那已經靠加密解決了），而是在解決：(a) 降低儲存與傳輸量，(b) 控制這篇筆記會不會出現在你登入同一帳號的其他裝置上（例如不想讓某些筆記出現在公司電腦）。這個前提會決定第 3 節加密邊界怎麼設計。

---

## 2. 金鑰模型（本階段核心設計決策）

延續 2.3「忘記密碼只能找回帳號、無法解開雲端舊資料」：密碼本身不是加密金鑰，只是**解鎖**金鑰的其中一把鑰匙。

```
每個知識庫各自的主金鑰 KEK（AES-256，裝置上隨機產生，永不明文送出裝置）
  ├─ 以「密碼衍生金鑰」包裹一份 → 存於 Supabase（wrapped_key_password）
  └─ 以「復原碼衍生金鑰」包裹一份 → 存於 Supabase（wrapped_key_recovery）
```

KEK 是**每個知識庫各一把**，不是整個帳號共用一把：同一帳號可以有多個知識庫（各自獨立的 `vaultId`），各自的金鑰互不相通。這讓「舊知識庫的復原碼也遺失、資料回不來了」這種情況，可以在同一帳號底下開一個新知識庫、配新的 KEK 繼續用，不必重新註冊帳號；舊知識庫的密文留在雲端但永久解不開，使用者之後可以選擇手動刪除。

- **註冊**：產生 KEK → 產生 32 字元復原碼（分組顯示，如 `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`）→ 密碼與復原碼各自經 PBKDF2（或 Argon2id，見第 5 節開放決策）衍生出包裹金鑰 → 兩份包裹後的 KEK 連同帳號一起送到 Supabase。復原碼只顯示一次，前端不留存，畫面上強制要求使用者確認已抄下才能繼續。
- **登入（既有裝置或新裝置）**：輸入密碼 → 下載 `wrapped_key_password` → 本機衍生金鑰解開 KEK → 之後所有同步資料用 KEK 加解密。KEK 全程不離開裝置。
- **忘記密碼**：Supabase Auth 標準的 email 重設流程只能重設登入密碼本身，不會、也不能還原 `wrapped_key_password`（因為伺服器從未看過舊密碼或 KEK）。重設完成後，App 偵測到「有帳號但解不開本機未曾快取的 KEK」，導向「輸入復原碼」畫面：用復原碼衍生金鑰解開 `wrapped_key_recovery` 取得 KEK → 用新密碼重新包裹一份覆蓋 `wrapped_key_password`。使用者若復原碼也遺失，雲端資料永久無法解密（畫面需明確警告，且只能選擇「放棄雲端資料、建立新知識庫」）。
- **新裝置加入**：等同登入流程，密碼衍生金鑰可直接解開 `wrapped_key_password`，不需要復原碼（復原碼只在忘記密碼時需要）。
- **伺服器看得到什麼**：帳號 email、裝置列表與時間戳記、知識庫 id、加密後的結構文件／筆記文件／附件（密文）、兩份包裹金鑰的密文。看不到：筆記標題、內容、資料夾名稱、標籤（因為結構文件本身也整份加密，見第 3 節）。

---

## 3. 同步資料與加密邊界

三種 Yjs 文件（結構文件、筆記文件、個人偏好文件）要上雲前**全部**加密，不可明文上雲：

- 本機既有的 `updates` / `snapshots` 表繼續存明文（純本機模式不受影響，效能也不必為加密付出代價）
- 新增同步佇列：每筆要上傳的增量先以 KEK（AES-GCM，每筆隨機 IV）加密，才送往 Supabase；下載回來的增量先解密才送進 Yjs 文件
- 附件比照：本機 `blobs` 表存明文，上傳前用 KEK 加密成獨立物件存 Supabase Storage

### 3.1 選同步的單位：筆記，不是整個知識庫

每篇筆記在本機結構文件的 `notes[id]` 多一個欄位 `synced: boolean`（預設見第 5 節開放決策）。因為每篇筆記本來就是獨立的 Yjs 文件（`docId` = 筆記 id），「同步哪些筆記」天生對齊到「`doc_updates`／`doc_snapshots` 裡有沒有這個 `docId` 的資料」，不需要額外的篩選邏輯：

- 勾選同步某篇筆記 → `sync-engine` 把該筆記文件目前狀態整份加密上傳（視為該 `docId` 的初始快照），之後該篇的增量比照一般流程持續推送
- 取消同步某篇筆記 → `sync-engine` 刪除 Supabase 上該 `docId` 的所有 `doc_updates`／`doc_snapshots` 列與附件物件，並停止對該 `docId` 繼續推送（但**不刪除本機內容**——本機永遠保留原本資料，取消同步只影響雲端與其他裝置，細節見 8.5、9）

**結構文件例外**：結構文件（存放全部筆記的標題、資料夾、順序，含未同步的筆記）如果整份原封不動加密上傳，等於間接把「未同步筆記存在、標題是什麼」也送上雲、流到其他裝置。所以結構文件改成**雲端只存篩選過的衍生版本**：由 `sync-engine` 在本機算出「只含 `synced: true` 的筆記、以及放置這些筆記所需的資料夾鏈」的一份精簡清單，加密後當成一個獨立的 `docId`（例如 `vaultId + '-manifest'`）上傳；未勾選同步的筆記與其所在資料夾（如果該資料夾底下沒有任何已同步筆記）完全不會出現在這份清單裡。其他裝置下載的，就是這份精簡清單，而不是本機完整的結構文件。

---

## 4. 資料模型（Supabase）

延續 2.3「使用者 → 裝置 → 知識庫 → 筆記／附件 → 分享連結」：

| 資料表 | 欄位 | 說明 |
|---|---|---|
| `auth.users` | （Supabase Auth 內建） | email + 密碼雜湊，Supabase 管理 |
| `vault_keys` | `vaultId`, `userId`, `wrappedKeyPassword`, `kdfParamsPassword`, `wrappedKeyRecovery`, `kdfParamsRecovery` | 每知識庫一列（非每使用者一列）；密碼與復原碼是兩個獨立的秘密、各自隨機 salt，所以 KDF 參數要分開存兩份，不是共用一份（3a/3b 實作時發現原稿寫成單一 `kdfParams` 是疏漏，已更正） |
| `devices` | `id`, `userId`, `name`, `createdAt`, `lastSeenAt` | 裝置顯示名稱可由使用者自訂（如「我的 MacBook」） |
| `vaults` | `id`, `userId`, `createdAt` | 第 1 階段本機知識庫 id 直接延用為此處的 `id` |
| `doc_updates` | `vaultId`, `docId`, `seq`, `ciphertext`, `deviceId`, `createdAt` | 密文增量；`docId` 對應結構清單 / 已同步的各筆記文件 / 偏好文件。一篇筆記有沒有同步，等同於這張表有沒有它的 `docId` |
| `doc_snapshots` | `vaultId`, `docId`, `ciphertext`, `upToSeq` | 密文快照 |
| `attachment_refs` | `vaultId`, `attachmentId`, `noteId`, `size`, `createdAt`（主鍵 `vaultId+attachmentId+noteId`） | 「哪篇同步中的筆記用了哪個附件」，多對多（同本機 `attachmentRefs`）；密文本身在私有 Storage bucket `attachments`，路徑 `<vaultId>/<attachmentId>`。取消某筆記同步時只刪它的參照，沒有其他同步筆記在用的附件才刪檔。`size` 為加密後位元組數 |
| `share_links` | （欄位預留，第 4 階段實作） | 本階段只建表不寫入邏輯 |

Row Level Security：每張表以 `auth.uid() = userId`（或透過 `vaults.userId` 間接）限制，使用者只能讀寫自己的資料；`doc_updates` / `doc_snapshots` / Storage 附件對伺服器而言皆為不透明密文，RLS 只做歸屬權限，不做內容檢查。

---

## 5. 技術選型與開放決策

| 項目 | 選擇 | 理由 |
|---|---|---|
| 後端 | Supabase（Auth + Postgres + Storage） | 沿用 2.4 決策 |
| 加密 | WebCrypto `AES-GCM`（內容）+ `PBKDF2`（密碼／復原碼衍生金鑰） | 瀏覽器原生支援、免額外相依套件；缺點是 PBKDF2 抗 GPU 暴力破解不如 Argon2 |
| 同步傳輸 | Supabase Realtime（Postgres changes）推播新增量；離線時輪詢補齊 | 多裝置即時性夠用，免自架 WebSocket |

**開放決策（需要你確認，列入文件「待審閱」狀態）**：

1. **KDF 選 PBKDF2 還是 Argon2id**：PBKDF2 可直接用 WebCrypto、零額外套件；Argon2id 安全性更好但需引入 WASM 套件（增加打包體積、需確認瀏覽器相容性）。`kdfParamsPassword`/`kdfParamsRecovery` 欄位已把演算法存成可升級的參數，先上 PBKDF2、日後要換不需要改資料模型。
2. **裝置上限**：規格沒提到是否限制單一帳號的裝置數量。建議先不限制（Supabase 免費方案用量低時不是瓶頸），但 `devices` 介面要能移除裝置（登出遠端裝置、失竊時用）。
3. **離線編輯後的上傳順序**：單裝置內的增量天生有序（`seq` 遞增），多裝置間的合併交給 Yjs CRDT，這部分不需要額外決策；但「使用者在舊版本未同步前，離線超久（例如 Supabase 專案因一週無活動被免費方案暫停，見第 1 階段規格第 15 節風險）」時的重試與提示文案，建議實作時再定，不影響本文件的架構決策。
4. **新筆記預設同步還是不同步**：啟用同步後，之後新增的筆記預設要自動打勾同步，還是預設不同步、每篇都要手動選？建議**預設不同步**（opt-in）：符合本機優先、使用者主動選擇要上雲的資料這個精神，也跟你這次提的需求一致（你是主動點名 A、C 要同步，不是「全部同步、B 除外」）。
5. **偏好文件（外觀設定）是否也要能選擇不同步**：2.7「外觀設定隨帳號同步」是已定案決策，且偏好文件不含筆記內容，建議偏好文件維持「只要啟用同步就一定同步」，不納入逐篇筆記的選擇性同步範圍——只有筆記（含附件）適用 3.1 節的開關。

若這五點沒意見，我會照建議值（PBKDF2、不限裝置數、重試文案留到實作時定、新筆記預設不同步、偏好文件固定同步）進行。

---

## 6. 架構分層（新增部分）

```
src/
  adapters/
    crypto/    新增 — 金鑰包裹／解包、AES-GCM 加解密、KDF（介面與第 1 階段「轉接層皆可替換」原則一致）
    sync/      新增 — 與 Supabase 的推／拉、Realtime 訂閱、裝置列表
  core/
    account/   新增 — 註冊、登入、復原碼流程、裝置管理的純邏輯（不依賴 React，同原則）
    sync-engine/  新增 — 本機 updates 表與雲端的差異比對、佇列、重試
  features/
    auth/      新增 — 登入/註冊/復原碼畫面
    settings/  擴充 — 帳號與裝置管理頁籤
```

延續第 1 階段規則：核心層不依賴 React、轉接層以介面定義可替換、上層依賴下層。`core/sync-engine` 依賴 `adapters/sync`、`adapters/crypto`、`adapters/storage`（讀本機 `updates` 表的游標）。

---

## 7. 模組職責

| 模組 | 職責 | 依賴 |
|---|---|---|
| `adapters/crypto` | `deriveKey(secret, params)`、`wrapKey`/`unwrapKey`、`encrypt`/`decrypt` | WebCrypto |
| `adapters/sync` | `push(vaultId, docId, ciphertext)`、`pull(vaultId, since)`、`subscribe(vaultId, onUpdate)`、`listDevices`、`removeDevice` | `@supabase/supabase-js` |
| `core/account` | `signUp`、`signIn`、`resetPassword`、`recoverWithCode`、產生與顯示復原碼（只顯示一次） | adapters/crypto, Supabase Auth |
| `core/sync-engine` | 監聽**已標記同步**筆記的本機 `updates` 新增 → 加密 → 推送；訂閱雲端新增量 → 解密 → 餵回本機 Yjs 文件；`setNoteSynced(noteId, true/false)`：開啟時整份上傳初始快照，關閉時刪除雲端該 `docId` 的全部資料與附件；維護雲端結構清單（3.1 節的精簡版）隨 `synced` 筆記增減即時重算並上傳 | adapters/sync, adapters/crypto, adapters/storage, core/vault |
| `features/auth` | 註冊／登入／復原碼畫面 | core/account |
| `features/sidebar` / `features/settings` | 擴充：每篇筆記的同步開關（側欄右鍵選單或筆記上方），以及設定頁「已同步筆記」清單總覽，可在清單裡批次取消 | core/sync-engine |

---

## 8. 主要流程

**啟用同步（既有本機使用者，初次註冊）**：設定頁「啟用同步」→ 輸入 email/密碼 → `core/account.signUp` 產生 KEK 與復原碼 → 顯示復原碼要求確認抄下 → 完成帳號設定，但**此時還沒有任何筆記被同步**（偏好文件例外，見 5 節開放決策）；使用者接著個別勾選要同步的筆記，逐篇觸發 8.5 的流程。

**新裝置登入**：安裝/開啟 App → 選「登入」而非「本機模式」→ 輸入 email/密碼 → 若該帳號只有一個知識庫直接選用；若有多個（例如曾因遺失復原碼而新建過），列出讓使用者選 → 下載對應 `vaultId` 的 `wrapped_key_password` 解出該知識庫的 KEK → `core/sync-engine` 拉取雲端結構清單（只含其他裝置已勾選同步的筆記）與這些筆記的快照、增量 → 解密 → 寫入本機 `updates`/`snapshots` 表，呈現在資料夾樹中並標記「已同步」→ 之後與既有裝置一致地同步。本機原有的其他筆記（若此裝置先前已是本機模式使用者）維持不動、不受影響。

**8.5 單篇筆記切換同步狀態**：
- **開啟**：`sync-engine.setNoteSynced(noteId, true)` → 把該筆記目前內容加密成初始快照上傳 → 更新雲端結構清單納入此筆記（含必要的資料夾鏈）→ 之後比照一般流程推送增量
- **關閉**：確認對話框說明「其他已下載這篇筆記的裝置會保留目前看到的內容，但往後不會再更新；這篇筆記的雲端副本會被刪除」→ 確認後 `sync-engine` 刪除該 `docId` 在 Supabase 的全部 `doc_updates`／`doc_snapshots`／附件 → 從雲端結構清單移除 → 本機內容不受影響，照常可繼續編輯，只是不再推送

**忘記密碼**：設定頁或登入畫面「忘記密碼」→ Supabase 標準 email 重設 → 重設完成登入後偵測 `wrapped_key_password` 解不開（因為是新密碼）→ 導向「輸入復原碼」→ 解開 KEK → 用新密碼重新包裹覆蓋 `wrapped_key_password`。

**日常編輯**：與第 1 階段相同，額外多一步：`core/sync-engine` 監聽到 `updates` 表有新增量，加密後推送；同時訂閱雲端 Realtime，收到其他裝置的新增量就解密餵回本機 Yjs 文件（與既有的 `tabs-bridge` 分頁內同步並行、互不干擾，因為一個是 BroadcastChannel、一個是跨裝置）。

---

## 9. 錯誤處理（新增於第 1 階段規格第 12 節之上）

| 情況 | 處理 |
|---|---|
| 離線 | 本機照常可編輯（本機優先原則不變）；`sync-engine` 佇列累積待推送增量，恢復連線後自動補送 |
| Supabase 專案因長期無活動被免費方案暫停 | 偵測到連線失敗時提示「雲端同步暫時無法連線，本機資料不受影響」，不阻塞本機使用 |
| 復原碼遺失且忘記密碼 | 明確警告「這個知識庫的雲端資料將永久無法復原」，提供「放棄這個知識庫、在同一帳號下建立新知識庫」選項——不必重新註冊帳號，新知識庫會有自己全新的一把 KEK |
| 兩裝置同時啟用同步、各自有不同本機資料 | 第一次啟用同步的裝置資料上雲；第二個裝置登入同一帳號時，若偵測到本機已有「未同步的本機知識庫」，提示使用者選擇「併入雲端知識庫」或「保留為獨立知識庫」，不靜默覆蓋 |
| 加解密失敗（資料毀損或金鑰不符） | 等同第 1 階段「單篇筆記損壞」處理：只標記該文件錯誤，不影響其他文件，保留原始密文不覆寫 |
| 取消同步時裝置離線 | 取消動作先在本機標記 `synced: false` 並記入待處理佇列；恢復連線後才真正送出雲端刪除，佇列處理前這篇筆記仍可能被其他裝置看到舊內容 |
| 筆記已取消同步，但另一裝置當下正在離線編輯它 | 該裝置恢復連線後，因為雲端已無此 `docId`，`push` 會收到「找不到目標」的回應；視同這篇筆記在該裝置上回到本機模式（不再嘗試推送，不報錯打斷使用者），不會逆向把已刪除的雲端資料復活 |

---

## 10. 測試計畫

- **`adapters/crypto` 單元測試**：KDF 輸出穩定性、wrap/unwrap 往返、AES-GCM 加解密往返、錯誤金鑰解密應明確失敗
- **`core/account` 單元測試**：註冊流程產生的兩份包裹金鑰皆可各自解回同一 KEK；復原碼重設密碼流程
- **`core/sync-engine` 單元測試（mock `adapters/sync`）**：本機增量正確加密後呼叫 `push`；收到遠端加密增量正確解密並寫回本機
- **端對端測試（Playwright，需起本機 Supabase 或測試專案）**：註冊 → 編輯 → 第二裝置登入看到相同內容 → 離線編輯 → 恢復連線後兩端一致
- 依你的省用量原則，本階段屬高風險改動（帳號、同步、加密），實作完成後另外跑一次獨立審查，而不是像一般小改動自己測完就過

---

## 11. 里程碑拆分（供實作排序，降低單次改動風險）

1. **3a**（已完成，`v2` @ `4b56cfc`）— `adapters/crypto`：KDF、wrap/unwrap、加解密，純單元測試，不碰網路
2. **3b**（已完成）— `core/account`：註冊/登入/忘記密碼/復原碼/建新知識庫，用 `MemoryAuth`／`MemoryKeyStore` 假轉接層驗證金鑰模型正確；真正接 Supabase Auth 留到有專案時再做
3. **3c**（已完成，全部在真實 Supabase 專案上跑過 `npm run sync:smoke-test` 驗證）：
   - `adapters/sync` 的 push/pull/snapshot/delete/listDocs，對應 doc_updates/doc_snapshots 資料表與 RLS。
   - `NoteMeta.synced` 欄位與 `Vault.setNoteSynced()`。
   - 雲端結構清單：`core/sync-engine/manifest.ts`（`deriveManifest`，純篩選）、`manifest-codec.ts`（`encodeManifest`/`decodeManifest`，過濾後的清單 ↔ Yjs 文件位元組）、`manifest-sync.ts`（`pushManifest`/`pullManifest`，加密後走 `SyncAdapter.pushSnapshot`/`pullDoc`，固定 docId = `vaultId + '-manifest'`，每次都整份覆蓋、不走增量）——即時驗證確認雲端那份 row 是不透明密文，沒有外洩明文標題。
   - 附件的加密上傳/下載：`adapters/sync/attachment-types.ts`（`AttachmentSyncAdapter` 介面）、`memory-attachment-sync.ts`（假轉接層）、`supabase-attachment-sync.ts`（真實轉接層，Storage bucket 名稱 `attachments`，`attachment_refs` 資料表只記歸屬，不存密文）、`core/sync-engine/attachment-sync.ts`（`pushAttachment`/`pullAttachment`，加密邊界）——即時驗證確認 Storage 裡的物件是密文、`deleteAttachmentsForNote` 正常清除。
   - 資料表與 RLS 的 migration：`supabase/migrations/0001_phase3_schema.sql`、`0002_attachment_refs_and_storage.sql`（Storage bucket 與其 RLS 也寫進來了，不再靠 Dashboard 手動建），兩份都可重複執行。
   - 3c 審查後的修正：(1) 附件歸屬改多對多（`attachment_refs`），避免關掉一篇筆記的同步就刪掉另一篇還在用的附件；(2) 所有上雲密文都以 AES-GCM AAD 綁定所屬的 vault + doc／附件 id（`core/sync-engine/doc-crypto.ts`，3d 的筆記同步也必須走這裡），伺服器無法把密文搬到別的位置冒充；(3) `downloadAttachment` 只有物件不存在才回 `null`，其餘錯誤丟 `SyncError`；(4) 刪附件時 Storage 刪除失敗會丟錯，且先刪檔再刪參照，不留下孤兒檔案。
   - 留給 3d（多裝置才會發生）：`nextSeq` 讀最大值 +1 的競態（unique 約束會擋下、不會默默覆蓋）；`pullDoc` 讀快照與增量分兩次查詢，中間若有另一台裝置壓縮可能漏更新；`deleteAttachmentsForNote` 判斷「沒人在用」與刪檔之間另一台裝置加參照的競態；`createVault` 先寫 `vaults` 再寫 `vault_keys` 非原子。
   - 還沒接上「`synced` 或結構變動時自動觸發重算 manifest」的事件監聽（manifest 目前是純函式，由呼叫方決定何時呼叫；這塊打算併入 3d 的 `core/sync-engine` 即時同步引擎一起做，而不是另外在 3c 生出一個半成品的本機監聽器）。
4. **3d**（已完成）— `core/sync-engine` 即時同步：
   - `adapters/sync/types.ts` 新增 `SyncAdapter.subscribe(vaultId, onChange)`：`SupabaseSync` 訂閱 `doc_updates`／
     `doc_snapshots` 的 Realtime postgres_changes（需要 migration 0003 把這兩張表加進 `supabase_realtime`
     publication）；`MemorySync` 用同步、同行程的 in-memory 版本供測試用。
   - `core/sync-engine/cloud-doc.ts`：`bindCloudDoc` 是雲端版的 `bindPersistence`——本機編輯排隊、加密、推送、
     失敗退避重試；同時訂閱雲端變更，收到別裝置的通知就整份重新 `pullDoc`＋解密＋套用（Yjs 更新本來就是冪等
     的，整份重套用比追蹤「差多少」簡單且一樣正確，跟 `tabs-bridge.ts` 的 `sync-step2` 同樣道理）；用
     `deviceId` 過濾掉自己推送觸發的回音通知。`pushInitialSnapshot` 處理 8.5「開啟」那次性的整份上傳。
   - `core/sync-engine/sync-manager.ts`：`createSyncManager` 把 `Vault`／`NoteDocCache`／manifest／附件接起來
     ——觀察 vault 偵測哪些筆記的 `synced` 被打開/關閉，對應呼叫初始快照上傳＋即時綁定，或刪雲端文件＋附件；
     結構（標題、資料夾、`synced`）一變就 debounce 重算並推送 manifest；筆記內容新增的附件 id 也會順便推上去。
   - `core/sync-engine/device-id.ts`：每個瀏覽器一個穩定 id（localStorage），當 `pushUpdate` 的 `deviceId`，
     也用來判斷 realtime 通知是不是自己推送造成的回音。
   - 補上設計文件 §11 留給 3d 的 4 個競態問題：
     1. `nextSeq` 搶號——`unique (vault_id, doc_id, seq)` 本來就會擋下輸家，`pushUpdate` 现在抓到
        `unique_violation` 就重算 seq 重試（上限 5 次）。
     2. `pullDoc` 快照／增量分兩次查詢的競態——查詢前後各讀一次快照的 `up_to_seq`，兩次不一樣（代表中間有人
        壓縮）就整個重試（上限 5 次），不會回傳「舊快照＋被壓縮扣掉的增量」這種不一致的組合。
     3. `deleteAttachmentsForNote`「沒人在用」判斷與刪檔之間的競態——新增 migration 0003 的
        `reap_note_attachment_refs`／`add_attachment_ref` 兩個 RPC，用同一把 `pg_advisory_xact_lock`
        把「刪這篇筆記的參照＋算出誰歸零」和「新增參照」在資料庫端序列化成不會交錯；刪 Storage 檔案前再查一次
        確認還是沒人用，把剩下「RPC 交易 commit 之後、真的刪檔之前」這段無法用資料庫鎖收斂的窗口盡量縮小
        （已在程式註解裡說明這是刻意的取捨，不是遺漏）。
     4. `createVault` 先寫 `vaults`再寫 `vault_keys` 非原子——migration 0003 的 `create_vault_with_keys` RPC
        把兩個 insert 包進同一個 Postgres 函式（天生一個交易），失敗就整個回滾，不會留孤兒知識庫。
   - 補上「已經在跑的裝置持續拉 manifest 合併進本機結構」（討論後決定的規則，不是自己腦補）：
     `core/sync-engine/manifest-merge.ts` 的 `mergeManifestIntoVault` 只會「補」本機完全沒有的筆記/資料夾
     id（資料夾按父層優先序建立，缺的那棵 ancestor chain manifest 本來就帶齊了），絕不覆寫本機已經有的任何
     id——包含使用者自己在本機把某篇筆記的同步關掉的情況（`synced:false` 但本機還有），這種「先 desync 再在
     另一台裝置 resync」不需要特殊處理，因為合併邏輯本來就只填「本機完全沒見過」的 id。id 同時出現在本機又
     出現在 manifest 時，先比對 `createdAt`：相同代表是同一篇筆記（本來就在，不用動），不同代表 nanoid(21)
     極低機率但理論上可能的「兩篇不相關筆記撞到同一個 id」，這種情況完全不動本機筆記，只把衝突的 id 回報給
     `sync-manager.ts`既有的 `onError` callback，不做自動改名也不做 UI（機率太低不值得）。`sync-manager.ts`
     在 `start()` 時先拉一次（涵蓋還沒重啟過的裝置漏接的別人新 synced 筆記），之後訂閱 manifest 文件本身的
     realtime 通知持續拉（manifest 的推送通知目前沒有 per-device 回音過濾，`deviceId` 固定是空字串——但不影
     響正確性：重新合併「自己剛推上去、本來就是從本機狀態算出來的」manifest 永遠是 no-op，只是多一次無謂的
     pull，不值得為了省這個另外做比對）。刻意沒做：不會把「另一台裝置改了某篇已經在本機同步中的筆記標題/資
     料夾」同步回來——那是更大範圍的「已綁定筆記的結構即時同步」問題，沒人要求做這個，這裡只處理「建立本機
     完全沒有的」。
     - §9 錯誤處理表裡「推送目標被別裝置刪除時應該回傳找不到、裝置端悄悄退回本機模式」、離線佇列重開機後還
       在——這兩個照 §11 本來就是 3e 的範圍，不是 3d 漏做。
   - 屬於高風險改動，完成後跑了一次獨立審查，抓到 2 個問題，都已修正並補了回歸測試：
     1. `sync-manager.ts` 把 manifest 合併的衝突一律回報成「id 相同但 createdAt 不同」的訊息，但
        `manifest-merge.ts` 的 `conflicts` 其實有兩種成因（id 碰撞 vs. `createNote` 因為標題撞到本機另一
        篇不相關筆記、或它需要的資料夾沒建成功而失敗），卻共用同一句話回報，誤導看 `onError` 的人去查錯方
        向。改成 `ManifestMergeResult.conflicts` 帶 `reason: 'id-collision' | 'create-failed'`，
        `sync-manager.ts` 依 reason 給不同訊息。
     2. `close()` 原本的順序是「`closed = true` → `unobserve()` → 才 `await manifestMergeChain`」：如果
        manifest 合併剛好在 `close()` 呼叫的那一刻已經在 pull／解密中（已經 debounce 觸發、無法用取消 idle
        callback擋下），合併本身還是會跑完、筆記還是會建立且標成 `synced: true`，但因為 `unobserve()` 已經
        先把 vault observer 拆掉，合併呼叫的 `setNoteSynced` 再也觸發不到 `onVaultChange`，這篇筆記這次
        session 就永遠不會被 `turnOn`——本機狀態說「已同步」，但實際上沒有即時綁定，要等下次 `start()` 才
        會自我修復。改成先 `await manifestMergeChain`（連同它觸發的 `noteChains` 項目）、確認合併與其引發的
        `turnOn` 都跑完，才設 `closed = true` 並 `unobserve()`。用一個會延遲 `pullDoc` 呼叫的假
        `SyncAdapter`（取代盲猜固定 `wait()` 時間）precisely 重現了這個競態，修正前兩個測試都會真的失敗。
     - `devices` 表的列管理（新裝置登入時寫入、列出、移除裝置）：`adapters/sync/types.ts` 3c 時的註解把它標成
       「3d 再做」，但 §11 真正描述 3d 的那行只提即時同步跟多裝置驗證，沒有要求裝置管理 UI，這次也還沒寫。
     - 個人偏好文件還沒接進 `createSyncManager`（它吃的是 `Vault`，不是 `Preferences` 實例）；`cloud-doc.ts`
       是通用的，接的人可以直接對 `Preferences` 的 doc 呼叫 `bindCloudDoc`，但還沒有人在呼叫。
   - 屬於高風險改動（同步、加密、帳號），完成後跑了一次獨立審查（審查者沒看過實作過程），抓到 2 個不在上述 4
     個競態問題清單裡、審查前沒發現的 bug，都已修正並補了回歸測試（對照舊邏輯跑過，確認新測試在修正前真的會
     失敗，不是形同虛設）：
     1. `cloud-doc.ts` 的壓縮（compaction）判斷式原本拿伺服器端「這個文件從開始到現在的累計 seq」跟
        `compactAfter` 比較，但這個 seq 永遠只增不減（壓縮後也不會歸零，見 `nextSeq`），一旦衝過門檻之後
        *之後每一次推送都會整份重新上傳快照*，不是每 200 筆才整份上傳一次——改成本地維護一個「上次壓縮後推送
        了幾筆」的計數器，壓縮後歸零，跟 `core/persist.ts` 的 `count` 同一個做法。
     2. `sync-manager.ts` 原本收到 vault 變動就直接呼叫 `turnOn`/`turnOff`，兩個都是 async 又沒互相等待：
        一篇筆記在 `turnOn` 還沒跑完時被使用者又關掉同步，`turnOff` 當下看不到 `noteBindings` 裡有東西
        （以為沒什麼好清的）但還是會呼叫雲端刪除；慢了一步跑完的 `turnOn` 之後才把 binding 註冊進去，等於
        使用者明明已經關掉同步，筆記卻又悄悄被推回雲端，而且 `NoteDocCache` 的引用計數也沒人會再釋放。改成
        每篇筆記一條序列化的操作佇列，佇列裡每一步執行當下才重新讀「現在應該怎樣」（vault 的即時 `synced`
        值）跟「現在實際怎樣」（`noteBindings` 有沒有這筆），而不是相信當初判斷差異時的那個瞬間快照。
5. **3e** — 錯誤處理與邊角案例：離線佇列、專案暫停提示、兩裝置各有本機資料的合併選擇

每個里程碑可獨立合併進 `v2` 分支，3a/3b 風險較低可依你的一般流程處理，3c 起涉及資料儲存與同步，建議照你的高風險改動規則另外審查。

---

## 12. 與現有程式碼的整合點

- `adapters/storage/types.ts` 的 `StorageAdapter` 介面不需改動，`core/sync-engine` 透過既有的 `loadDoc`/`appendUpdate` 讀寫本機資料，只是多一層加密在推送／拉取時發生
- `core/vault`、`core/note-doc` 不需感知同步或加密的存在，維持「核心層不依賴同步」的分層
- `features/settings` 新增「帳號」頁籤，沿用既有設定頁版面與元件
