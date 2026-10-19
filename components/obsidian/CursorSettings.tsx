"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import JSZip from "jszip";

import {
  ACCEPTED_CURSOR_EXTENSIONS,
  CURSOR_PRESETS,
  DEFAULT_CURSOR_PREFERENCES,
  MAX_CURSOR_BYTES,
  MAX_CURSOR_ZIP_BYTES,
  deleteSavedCursor,
  cursorBytesToBuffer,
  getCursorExtension,
  getSavedCursor,
  normalizeIconBytes,
  parseAniCursor,
  readCursorPreferences,
  replaceSavedCursor,
  saveCursorPreferences,
  validateCursorFile,
  type CursorAssetRecord,
  type CursorFileKind,
  type CursorMode,
  type CursorPreferences,
} from "@/lib/obsidian/cursor";

type CursorCandidate = { file: File; kind: CursorFileKind; folder: string };

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function getMimeFromFilename(name: string): string {
  switch (getCursorExtension(name)) {
    case ".ani": return "application/x-navi-animation";
    case ".cur": return "image/x-icon";
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

export function CursorSettings() {
  const [prefs, setPrefs] = useState<CursorPreferences>(DEFAULT_CURSOR_PREFERENCES);
  const [saved, setSaved] = useState<CursorAssetRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CursorCandidate[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPrefs(readCursorPreferences());
    void getSavedCursor().then((record) => {
      if (cancelled) return;
      setSaved(record);
    }).catch((error) => {
      if (!cancelled) setMessage(`游標讀取失敗：${String(error)}`);
    }).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!saved) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    const build = async () => {
      try {
        if (saved.kind === "ani") {
          const frames = await parseAniCursor(saved.blob);
          url = URL.createObjectURL(frames[0].image);
        } else if (/\.(cur|ico)$/i.test(saved.filename)) {
          const bytes = new Uint8Array(await saved.blob.arrayBuffer());
          url = URL.createObjectURL(new Blob([cursorBytesToBuffer(normalizeIconBytes(bytes))], { type: "image/x-icon" }));
        } else {
          url = URL.createObjectURL(new Blob([saved.blob], { type: getMimeFromFilename(saved.filename) }));
        }
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
        } else setPreviewUrl(url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    };
    void build();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [saved]);

  function changePrefs(next: CursorPreferences) {
    try {
      saveCursorPreferences(next);
      setPrefs(next);
    } catch (error) {
      setMessage(`儲存設定失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function choosePreset(mode: CursorMode) {
    changePrefs({ ...prefs, mode });
    setMessage(mode === "system" ? "已恢復系統滑鼠游標。" : "已套用內建游標樣式。");
  }

  async function install(file: File, kind: CursorFileKind) {
    await replaceSavedCursor(file, kind);
    const record = await getSavedCursor();
    setSaved(record);
    changePrefs({ ...prefs, mode: "custom" });
    setCandidates([]);
    setMessage(`已套用「${file.name}」。舊的自訂游標已被覆蓋，不會累積。`);
  }

  async function loadZip(file: File): Promise<CursorCandidate[]> {
    if (file.size > MAX_CURSOR_ZIP_BYTES) {
      throw new Error("ZIP 游標包不可超過 20 MB");
    }
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) =>
      !entry.dir && ACCEPTED_CURSOR_EXTENSIONS.includes(getCursorExtension(entry.name))
    );
    if (!entries.length) throw new Error("ZIP 裡沒有可用的 CUR／ANI／ICO／PNG／GIF／WebP／JPG 游標");
    if (entries.length > 80) throw new Error("游標包內檔案太多（最多 80 個候選檔）");

    const output: CursorCandidate[] = [];
    for (const entry of entries) {
      // 避免不小心解壓巨量檔案（ZIP bomb）。
      const info = entry as typeof entry & { _data?: { uncompressedSize?: number } };
      if ((info._data?.uncompressedSize ?? 0) > MAX_CURSOR_BYTES) continue;
      const bytes = await entry.async("uint8array");
      if (!bytes.byteLength || bytes.byteLength > MAX_CURSOR_BYTES) continue;
      const filename = entry.name.split("/").pop() || "cursor.cur";
      const candidate = new File([cursorBytesToBuffer(bytes)], filename, { type: getMimeFromFilename(filename) });
      try {
        const kind = await validateCursorFile(candidate);
        output.push({ file: candidate, kind, folder: entry.name });
      } catch {
        // 略過游標包中損壞或不相容的檔案，不影響其他游標。
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
        if (loaded.length === 1) {
          await install(loaded[0].file, loaded[0].kind);
        } else {
          setCandidates(loaded);
          setMessage(`已找到 ${loaded.length} 個游標，請在下方選擇要套用的檔案。`);
        }
      } else {
        const kind = await validateCursorFile(file);
        await install(file, kind);
      }
    } catch (error) {
      setMessage(`匯入失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function installCandidate(item: CursorCandidate) {
    if (busy) return;
    setBusy(true);
    try {
      await install(item.file, item.kind);
    } catch (error) {
      setMessage(`套用失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearCustom() {
    if (!saved || busy) return;
    if (!window.confirm(`確定要永久刪除自訂游標「${saved.filename}」嗎？\n此動作不會刪除筆記附件或背景圖片。`)) return;
    setBusy(true);
    try {
      await deleteSavedCursor();
      setSaved(null);
      changePrefs({ ...prefs, mode: "system" });
      setMessage("已清除自訂游標並恢復系統預設。");
    } catch (error) {
      setMessage(`刪除失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const customActive = prefs.mode === "custom";
  const inputClass = "w-full accent-[#91ada5] disabled:opacity-40";

  return (
    <section className="space-y-5 p-5" aria-label="滑鼠游標設定">
      <div>
        <h3 className="text-sm font-medium text-slate-200">滑鼠樣式</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          每位使用者可在自己的瀏覽器選擇樣式。手機觸控時不顯示游標，不影響觸控操作。
        </p>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium text-slate-300">內建樣式（僅保留星芒）</h4>
        <div className="flex flex-wrap gap-2">
        {CURSOR_PRESETS.map((preset) => (
          <button
            key={preset.mode}
            type="button"
            disabled={!ready || busy}
            aria-pressed={prefs.mode === preset.mode}
            onClick={() => choosePreset(preset.mode)}
            className={`flex min-h-24 w-48 max-w-full flex-col items-start border px-3 py-3 text-left transition disabled:opacity-40 ${
              prefs.mode === preset.mode
                ? "border-cyan-500/70 bg-cyan-950/25 text-cyan-100"
                : "border-white/10 text-slate-300 hover:border-white/30"
            }`}
          >
            <span className="mb-2 text-2xl leading-none" aria-hidden="true">{preset.icon}</span>
            <strong className="text-xs font-medium">{preset.label}</strong>
            <span className="mt-1 text-[10px] leading-relaxed text-slate-500">{preset.description}</span>
          </button>
        ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          其他內建造型已移除。要使用原本滑鼠樣式，可點下方「恢復系統游標與預設設定」。
        </p>
      </div>

      <div className={`border p-3 ${customActive ? "border-cyan-500/50 bg-cyan-950/15" : "border-white/10 bg-white/[0.02]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-medium text-slate-200">自行上傳游標</h4>
            <p className="mt-1 text-[10px] text-slate-500">
              支援網路下載的 .cur、.ico、.ani 動態游標，以及 GIF／APNG／WebP／PNG／JPG。
            </p>
          </div>
          <button
            type="button"
            disabled={!saved || busy}
            onClick={() => choosePreset("custom")}
            className="border border-cyan-700/40 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-30"
          >
            套用已儲存的游標
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
          {saved && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearCustom()}
              className="border border-red-700/25 px-3 py-2 text-xs text-red-300 disabled:opacity-40"
            >
              刪除已上傳的游標
            </button>
          )}
        </div>

        {saved ? (
          <div className="mt-3 flex items-center gap-3 rounded border border-white/10 bg-black/20 p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-white/10 bg-[#232a2b]">
              {previewUrl ? (
                <img src={previewUrl} alt="目前游標預覽" className="max-h-12 max-w-12 object-contain" />
              ) : (
                <span className="text-2xl text-slate-500">↖</span>
              )}
            </div>
            <div className="min-w-0 text-[11px]">
              <div className="break-all text-slate-200">{saved.filename}</div>
              <div className="mt-1 text-slate-500">
                {formatBytes(saved.blob.size)} · {saved.kind === "ani" ? "ANI 動態" : saved.kind === "animated" ? "圖片動畫" : "靜態游標"}
              </div>
              <div className="mt-1 text-slate-600">新檔會覆蓋這個檔案，不會累積多個游標。</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-slate-600">目前尚未上傳游標檔案。單檔最多 8 MB；ZIP 最多 20 MB。</p>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="space-y-2 border border-cyan-800/35 bg-cyan-950/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-cyan-200">ZIP 游標包：選擇要使用的檔案</h4>
            <button type="button" onClick={() => setCandidates([])} className="px-2 text-xs text-slate-400">取消</button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((item, i) => (
              <button
                key={`${item.folder}-${i}`}
                type="button"
                disabled={busy}
                onClick={() => void installCandidate(item)}
                className="flex w-full items-center justify-between gap-3 border border-white/5 px-3 py-2 text-left text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                <span className="min-w-0 truncate" title={item.folder}>{item.folder}</span>
                <span className="shrink-0 text-cyan-200">使用此游標</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 border-t border-white/10 pt-4">
        <h4 className="text-xs font-medium text-slate-200">游標顯示設定</h4>
        <label className="block text-xs text-slate-400">
          <span className="mb-2 flex items-center justify-between">
            <span>游標大小</span><span>{prefs.size} px</span>
          </span>
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
          點擊位置決定圖片的哪一個點跟隨真正滑鼠座標：左上角是 0%／0%，中央是 50%／50%。
          此設定適用於自行上傳的靜態與動態游標；星芒使用其中心作為點擊位置。
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={prefs.preserveTextCursor} disabled={busy}
            onChange={(event) => changePrefs({ ...prefs, preserveTextCursor: event.target.checked })} />
          在文字輸入區保留 I 型游標（建議）
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => changePrefs({ ...DEFAULT_CURSOR_PREFERENCES })}
            className="border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
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
        Windows .ani 在瀏覽器中不是原生游標格式，本網站會擷取標準 ANI 影格播放。
        ZIP 只能讀取其中支援的游標檔案；不執行下載檔案中的程式，也不支援 EXE、RAR、7Z 或 SVG。
        有些特殊 ANI 影格可能無法顯示；GIF、APNG、WebP 動圖會以透明游標顯示層播放。
        自訂游標和背景分開儲存於本機，尚未包含在知識庫 ZIP 備份。
      </p>
    </section>
  );
}
