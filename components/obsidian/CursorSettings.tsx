"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import JSZip from "jszip";

import {
  ACCEPTED_CURSOR_EXTENSIONS,
  CURSOR_ROLE_OPTIONS,
  DEFAULT_CURSOR_PREFERENCES,
  MAX_CURSOR_BYTES,
  MAX_CURSOR_ZIP_BYTES,
  deleteSavedCursor,
  cursorBytesToBuffer,
  getCursorExtension,
  getSavedCursorTheme,
  guessCursorRole,
  normalizeIconBytes,
  parseAniCursor,
  readCursorPreferences,
  replaceSavedCursorTheme,
  saveCursorPreferences,
  validateCursorFile,
  type CursorFileKind,
  type CursorPreferences,
  type CursorRole,
  type CursorThemeAsset,
  type CursorThemeInput,
  type CursorThemeRecord,
} from "@/lib/obsidian/cursor";

type CandidateRole = CursorRole | "";
type CursorCandidate = { file: File; kind: CursorFileKind; folder: string; role: CandidateRole };

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function getMimeFromFilename(name: string): string {
  switch (getCursorExtension(name)) {
    case ".ani": return "application/x-navi-animation";
    case ".cur":
    case ".ico": return "image/x-icon";
    case ".png":
    case ".apng": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".jpeg":
    case ".jpg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

async function createPreviewUrl(asset: CursorThemeAsset): Promise<string> {
  if (asset.kind === "ani" || /\.ani$/i.test(asset.filename)) {
    const frames = await parseAniCursor(asset.blob);
    return URL.createObjectURL(frames[0].image);
  }
  if (/\.(cur|ico)$/i.test(asset.filename)) {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    return URL.createObjectURL(new Blob([
      cursorBytesToBuffer(normalizeIconBytes(bytes)),
    ], { type: "image/x-icon" }));
  }
  return URL.createObjectURL(new Blob([asset.blob], { type: getMimeFromFilename(asset.filename) }));
}

export function CursorSettings() {
  const [prefs, setPrefs] = useState<CursorPreferences>(DEFAULT_CURSOR_PREFERENCES);
  const [theme, setTheme] = useState<CursorThemeRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CursorCandidate[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPrefs(readCursorPreferences());
    void getSavedCursorTheme().then((record) => {
      if (!cancelled) setTheme(record);
    }).catch((error) => {
      if (!cancelled) setMessage(`游標主題讀取失敗：${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const entries = theme?.cursors;
    const previewAsset = entries?.default
      ?? Object.values(entries || {}).find((asset): asset is CursorThemeAsset => Boolean(asset));
    if (!previewAsset) {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    let url: string | null = null;
    void createPreviewUrl(previewAsset).then((nextUrl) => {
      if (cancelled) URL.revokeObjectURL(nextUrl);
      else {
        url = nextUrl;
        setPreviewUrl(nextUrl);
      }
    }).catch(() => {
      if (!cancelled) setPreviewUrl(null);
    });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [theme]);

  function changePrefs(next: CursorPreferences) {
    try {
      saveCursorPreferences(next);
      setPrefs(next);
    } catch (error) {
      setMessage(`儲存設定失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function chooseMode(mode: CursorPreferences["mode"]) {
    changePrefs({ ...prefs, mode });
    setMessage(mode === "system" ? "已恢復系統滑鼠游標。" : "已套用自訂游標主題。");
  }

  async function installSingle(file: File, kind: CursorFileKind) {
    const guessedRole = guessCursorRole(file.name) || "default";
    const existing = await getSavedCursorTheme();
    const next: CursorThemeInput = { ...(existing?.cursors || {}) };
    next[guessedRole] = { filename: file.name, blob: file, kind };
    await replaceSavedCursorTheme(next);
    const record = await getSavedCursorTheme();
    setTheme(record);
    changePrefs({ ...prefs, mode: "custom" });
    setCandidates([]);
    setMessage(`已將「${file.name}」加入「${CURSOR_ROLE_OPTIONS.find((item) => item.value === guessedRole)?.label || guessedRole}」狀態。其他已設定的狀態會保留。`);
  }

  async function loadZip(file: File): Promise<CursorCandidate[]> {
    if (file.size > MAX_CURSOR_ZIP_BYTES) throw new Error("ZIP 游標包不可超過 20 MB");
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) =>
      !entry.dir && ACCEPTED_CURSOR_EXTENSIONS.includes(getCursorExtension(entry.name))
    );
    if (!entries.length) throw new Error("ZIP 裡沒有可用的 CUR／ANI／ICO／PNG／GIF／WebP／JPG 游標");
    if (entries.length > 80) throw new Error("游標包內檔案太多（最多 80 個候選檔）");

    const output: CursorCandidate[] = [];
    for (const entry of entries) {
      const info = entry as typeof entry & { _data?: { uncompressedSize?: number } };
      if ((info._data?.uncompressedSize ?? 0) > MAX_CURSOR_BYTES) continue;
      const bytes = await entry.async("uint8array");
      if (!bytes.byteLength || bytes.byteLength > MAX_CURSOR_BYTES) continue;
      const filename = entry.name.split("/").pop() || "cursor.cur";
      const candidate = new File([cursorBytesToBuffer(bytes)], filename, {
        type: getMimeFromFilename(filename),
      });
      try {
        const kind = await validateCursorFile(candidate);
        output.push({
          file: candidate,
          kind,
          folder: entry.name,
          role: guessCursorRole(filename),
        });
      } catch {
        // 忽略損毀或不支援的檔案，不影響同一套主題中的其他檔案。
      }
    }
    if (!output.length) throw new Error("ZIP 內的游標都不支援或檔案已損毀");
    output.sort((a, b) => a.folder.localeCompare(b.folder));
    return output;
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    setCandidates([]);
    try {
      if (getCursorExtension(file.name) === ".zip") {
        const loaded = await loadZip(file);
        setCandidates(loaded);
        const autoMapped = loaded.filter((item) => item.role).length;
        setMessage(`已讀取 ${loaded.length} 個游標檔案，其中 ${autoMapped} 個已依檔名自動配對。請確認每個檔案的用途，再套用整套主題。`);
      } else {
        const kind = await validateCursorFile(file);
        await installSingle(file, kind);
      }
    } catch (error) {
      setMessage(`匯入失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function changeCandidateRole(index: number, role: CandidateRole) {
    setCandidates((current) => current.map((item, i) => i === index ? { ...item, role } : item));
  }

  async function applyThemeCandidates() {
    if (busy) return;
    const mapped = candidates.filter((item) => item.role);
    if (!mapped.length) {
      setMessage("請至少替一個檔案指定游標狀態。");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const next: CursorThemeInput = {};
      const seen = new Set<CursorRole>();
      const duplicates = new Set<CursorRole>();
      for (const item of mapped) {
        const role = item.role as CursorRole;
        if (seen.has(role)) duplicates.add(role);
        seen.add(role);
        next[role] = { filename: item.file.name, blob: item.file, kind: item.kind };
      }
      await replaceSavedCursorTheme(next);
      const record = await getSavedCursorTheme();
      setTheme(record);
      changePrefs({ ...prefs, mode: "custom" });
      setCandidates([]);
      const duplicateText = duplicates.size
        ? `；重複指定的狀態以清單中較後面的檔案為準：${Array.from(duplicates).join("、")}`
        : "";
      setMessage(`已套用游標主題，共設定 ${seen.size} 種操作狀態。未指定的狀態會使用一般指標；若未設定一般指標，則沿用系統游標${duplicateText}。`);
    } catch (error) {
      setMessage(`套用主題失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearCustom() {
    if (!theme || busy) return;
    if (!window.confirm("確定要刪除整套自訂游標主題嗎？此動作不會刪除筆記附件或背景圖片。")) return;
    setBusy(true);
    try {
      await deleteSavedCursor();
      setTheme(null);
      changePrefs({ ...prefs, mode: "system" });
      setMessage("已刪除自訂游標主題並恢復系統預設。");
    } catch (error) {
      setMessage(`刪除失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const customActive = prefs.mode === "custom";
  const inputClass = "w-full accent-[#91ada5] disabled:opacity-40";
  const themeEntries = Object.entries(theme?.cursors || {}).filter((entry) => Boolean(entry[1]));
  const mappedCandidates = candidates.filter((item) => item.role).length;

  return (
    <section className="space-y-5 p-5" aria-label="滑鼠游標設定">
      <div>
        <h3 className="text-sm font-medium text-slate-200">滑鼠樣式</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          可匯入完整游標主題，讓一般指標、文字、連結、等待、移動與縮放等操作各自使用不同圖示。手機觸控時不顯示滑鼠游標。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-white/[0.02] p-3">
        <div>
          <h4 className="text-xs font-medium text-slate-200">系統預設游標</h4>
          <p className="mt-1 text-[10px] text-slate-500">未設定的操作狀態會沿用系統游標。</p>
        </div>
        <button
          type="button"
          disabled={!ready || busy || prefs.mode === "system"}
          aria-pressed={prefs.mode === "system"}
          onClick={() => chooseMode("system")}
          className="border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-40"
        >
          {prefs.mode === "system" ? "目前使用系統預設" : "使用系統預設"}
        </button>
      </div>

      <div className={`border p-3 ${customActive ? "border-cyan-500/50 bg-cyan-950/15" : "border-white/10 bg-white/[0.02]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-medium text-slate-200">自訂游標主題</h4>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              支援 ZIP 游標包，以及單獨上傳 .cur、.ico、.ani、GIF、APNG、WebP、PNG、JPG。ZIP 匯入後可逐一指定用途。
            </p>
          </div>
          <button
            type="button"
            disabled={!theme || busy}
            onClick={() => chooseMode("custom")}
            className="border border-cyan-700/40 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-30"
          >
            套用已儲存主題
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            accept=".cur,.ani,.ico,.png,.apng,.gif,.webp,.jpg,.jpeg,.zip"
            onChange={(event) => void onUpload(event)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => uploadRef.current?.click()}
            className="border border-cyan-700/50 bg-cyan-950/20 px-4 py-2 text-xs text-cyan-200 disabled:opacity-40"
          >
            {busy ? "讀取檔案中…" : "上傳游標檔案 / ZIP 游標包"}
          </button>
          {theme && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearCustom()}
              className="border border-red-700/25 px-3 py-2 text-xs text-red-300 disabled:opacity-40"
            >
              刪除整套自訂主題
            </button>
          )}
        </div>

        {theme ? (
          <div className="mt-3 flex items-center gap-3 rounded border border-white/10 bg-black/20 p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-white/10 bg-[#232a2b]">
              {previewUrl ? (
                <img src={previewUrl} alt="目前游標主題預覽" className="max-h-12 max-w-12 object-contain" />
              ) : (
                <span className="text-2xl text-slate-500">↖</span>
              )}
            </div>
            <div className="min-w-0 text-[11px]">
              <div className="text-slate-200">已儲存的游標主題</div>
              <div className="mt-1 text-slate-500">已設定 {themeEntries.length} 種狀態</div>
              <div className="mt-1 break-words text-slate-600">
                {themeEntries.map(([role, asset]) => `${role}: ${(asset as CursorThemeAsset).filename}`).join(" · ")}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-slate-600">目前尚未上傳游標主題。單一檔案最多 8 MB；ZIP 最多 20 MB。</p>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="space-y-3 border border-cyan-800/35 bg-cyan-950/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-medium text-cyan-200">游標包狀態配對</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                系統會先依檔名猜測用途。請檢查配對；選「不指定」的檔案不會被套用。相同狀態若指定多次，以清單中較後面的檔案為準。
              </p>
            </div>
            <button type="button" onClick={() => setCandidates([])} className="shrink-0 px-2 text-xs text-slate-400">取消</button>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {candidates.map((item, index) => (
              <div key={`${item.folder}-${index}`} className="grid grid-cols-1 gap-2 border border-white/5 bg-black/10 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(170px,0.8fr)] sm:items-center">
                <div className="min-w-0">
                  <div className="break-all text-[11px] text-slate-200" title={item.folder}>{item.folder}</div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {formatBytes(item.file.size)} · {item.kind === "ani" ? "ANI 動態游標" : item.kind === "animated" ? "動畫圖片" : "靜態游標"}
                  </div>
                </div>
                <select
                  value={item.role}
                  disabled={busy}
                  onChange={(event) => changeCandidateRole(index, event.target.value as CandidateRole)}
                  className="min-w-0 border border-white/10 bg-[#15191a] px-2 py-2 text-[11px] text-slate-200"
                  aria-label={`指定 ${item.file.name} 的游標用途`}
                >
                  <option value="">不指定／略過</option>
                  {CURSOR_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <span className="text-[10px] text-slate-500">已指定 {mappedCandidates} / {candidates.length} 個檔案</span>
            <button
              type="button"
              disabled={busy || mappedCandidates === 0}
              onClick={() => void applyThemeCandidates()}
              className="border border-cyan-700/50 bg-cyan-950/30 px-4 py-2 text-xs text-cyan-100 disabled:opacity-40"
            >
              {busy ? "套用中…" : "套用整套游標主題"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4 border-t border-white/10 pt-4">
        <h4 className="text-xs font-medium text-slate-200">游標顯示設定</h4>
        <label className="block text-xs text-slate-400">
          <span className="mb-2 flex items-center justify-between"><span>游標大小</span><span>{prefs.size} px</span></span>
          <input
            className={inputClass}
            type="range" min="16" max="96" step="2"
            value={prefs.size}
            disabled={busy}
            onChange={(event) => changePrefs({ ...prefs, size: Number(event.target.value) })}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-xs text-slate-400">
            <span className="mb-2 flex justify-between"><span>點擊位置：水平</span><span>{prefs.hotspotX}%</span></span>
            <input className={inputClass} type="range" min="0" max="100" step="5" value={prefs.hotspotX}
              disabled={busy} onChange={(event) => changePrefs({ ...prefs, hotspotX: Number(event.target.value) })} />
          </label>
          <label className="block text-xs text-slate-400">
            <span className="mb-2 flex justify-between"><span>點擊位置：垂直</span><span>{prefs.hotspotY}%</span></span>
            <input className={inputClass} type="range" min="0" max="100" step="5" value={prefs.hotspotY}
              disabled={busy} onChange={(event) => changePrefs({ ...prefs, hotspotY: Number(event.target.value) })} />
          </label>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-600">
          點擊位置決定游標圖片的哪一點跟隨真正滑鼠座標。設定會套用到所有自訂游標狀態；系統預設游標不受影響。
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={prefs.preserveTextCursor} disabled={busy}
            onChange={(event) => changePrefs({ ...prefs, preserveTextCursor: event.target.checked })} />
          在文字輸入區保留系統 I 型游標（建議）
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" disabled={busy} onClick={() => changePrefs({ ...DEFAULT_CURSOR_PREFERENCES })}
            className="border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40">
            恢復系統游標與預設設定
          </button>
          <span className="text-[10px] text-slate-600">設定變更後立即生效</span>
        </div>
      </div>

      {message && (
        <p className="border border-white/10 bg-white/[0.025] p-3 text-xs leading-relaxed text-slate-200" role="status">
          {message}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-slate-600">
        ZIP 只讀取其中支援的游標檔案，不會執行任何程式。支援 CUR、ICO、ANI、GIF、APNG、WebP、PNG、JPG；不支援 EXE、RAR、7Z 或 SVG。標準 ANI 會逐格播放；無法辨識的檔名可在匯入清單手動指定。自訂主題儲存在目前瀏覽器，不包含在知識庫備份 ZIP 中。
      </p>
    </section>
  );
}
