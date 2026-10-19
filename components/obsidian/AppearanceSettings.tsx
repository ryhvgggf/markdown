"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  DEFAULT_APPEARANCE,
  deleteCustomBackground,
  getCustomBackground,
  loadAppearancePreferences,
  replaceCustomBackground,
  saveAppearancePreferences,
  type AppearanceMode,
  type AppearancePreferences,
  type AppearancePosition,
} from "@/lib/obsidian/appearance";

const POSITIONS: Array<{ value: AppearancePosition; label: string }> = [
  { value: "center center", label: "置中" },
  { value: "center top", label: "靠上" },
  { value: "center bottom", label: "靠下" },
  { value: "left center", label: "靠左" },
  { value: "right center", label: "靠右" },
];

const MODE_OPTIONS: Array<{
  value: AppearanceMode;
  title: string;
  description: string;
}> = [
  { value: "ink", title: "水墨預設", description: "保留原本山水／竹林／梅花" },
  { value: "dark", title: "純深色", description: "深色背景，不顯示圖片" },
  { value: "custom", title: "自訂圖片", description: "使用上傳的背景圖片" },
];

export function AppearanceSettings() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 初始化：外觀設定載入 localStorage，單一背景圖片載入 IndexedDB。
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const saved = loadAppearancePreferences();

      try {
        const background = await getCustomBackground();
        if (cancelled) return;

        if (background?.blob) {
          setImageUrl(URL.createObjectURL(background.blob));
          setFilename(background.filename);
          setPrefs(saved);
        } else {
          // 資料庫沒有圖片時，不讓「自訂」模式造成空白背景。
          setPrefs(saved.mode === "custom" ? { ...saved, mode: "ink" } : saved);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("讀取自訂背景失敗：", error);
        setPrefs(saved.mode === "custom" ? { ...saved, mode: "ink" } : saved);
        setMessage("背景圖片讀取失敗，已暫時顯示預設背景");
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  // 釋放替換／卸載後不再使用的 Object URL，避免暫存記憶體累積。
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // 讓所有版面（包括主編輯器、左右側欄、手機版）共用同一套背景設定。
  useEffect(() => {
    if (!ready) return;

    const actualMode: AppearanceMode =
      prefs.mode === "custom" && !imageUrl ? "ink" : prefs.mode;
    const body = document.body;

    body.setAttribute("data-appearance-mode", actualMode);
    body.style.setProperty(
      "--appearance-wallpaper-image",
      imageUrl ? `url("${imageUrl}")` : "none"
    );
    body.style.setProperty("--appearance-wallpaper-opacity", String(prefs.opacity));
    body.style.setProperty("--appearance-wallpaper-brightness", String(prefs.brightness));
    body.style.setProperty("--appearance-wallpaper-blur", `${prefs.blur}px`);
    body.style.setProperty("--appearance-wallpaper-fit", prefs.fit);
    body.style.setProperty("--appearance-wallpaper-position", prefs.position);

    try {
      saveAppearancePreferences({ ...prefs, mode: actualMode });
    } catch (error) {
      console.warn("儲存外觀設定失敗：", error);
    }
  }, [prefs, imageUrl, ready]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, busy]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const updatePrefs = useCallback((patch: Partial<AppearancePreferences>) => {
    setPrefs((old) => ({ ...old, ...patch }));
  }, []);

  function selectMode(mode: AppearanceMode) {
    if (mode === "custom" && !imageUrl) {
      fileInputRef.current?.click();
      return;
    }

    updatePrefs({ mode });
    setMessage(null);
  }

  async function onChooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      // put() 成功後才替換頁面 URL，避免儲存失敗時把舊圖弄丟。
      await replaceCustomBackground(file);
      const nextUrl = URL.createObjectURL(file);
      setImageUrl(nextUrl);
      setFilename(file.name);
      updatePrefs({ mode: "custom" });
      setMessage("已套用背景圖片；舊圖片已被覆蓋，不會保留第二份");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "圖片上傳失敗");
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    if (busy) return;

    const confirmRestore = window.confirm(
      "要恢復原本的水墨背景嗎？\n\n目前上傳的自訂圖片也會從本機 IndexedDB 刪除。"
    );
    if (!confirmRestore) return;

    setBusy(true);
    setMessage(null);

    try {
      await deleteCustomBackground();
      setImageUrl(null);
      setFilename("");
      setPrefs({ ...DEFAULT_APPEARANCE });
      setMessage("已恢復水墨預設背景，並刪除原本上傳的圖片");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "恢復背景失敗");
    } finally {
      setBusy(false);
    }
  }

  function downloadCurrentImage() {
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = filename || "custom-background.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const inputRangeClass = "w-full accent-[#a1b9b3]";
  const panelButtonClass =
    "border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="hidden"
        aria-label="選擇背景圖片"
        onChange={(event) => void onChooseImage(event)}
      />

      <button
        type="button"
        className="appearance-launcher"
        disabled={!ready || busy}
        onClick={() => setOpen(true)}
        aria-label="開啟外觀設定"
        title="外觀設定：背景圖片與顯示效果"
      >
        <span aria-hidden="true">⚙</span>
        <span>外觀設定</span>
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className="appearance-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !busy) setOpen(false);
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="appearance-dialog-title"
              tabIndex={-1}
              className="appearance-dialog outline-none"
            >
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <div>
                  <h2 id="appearance-dialog-title" className="font-serif text-base text-white">
                    外觀設定
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    設定僅保留在目前的瀏覽器
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-40"
                  aria-label="關閉外觀設定"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <div className="mb-2 text-xs text-slate-300">背景風格</div>
                  <div className="grid grid-cols-3 gap-2">
                    {MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        aria-pressed={prefs.mode === option.value}
                        onClick={() => selectMode(option.value)}
                        className={`min-h-[70px] border px-2 py-3 text-left transition-colors disabled:opacity-40 ${
                          prefs.mode === option.value
                            ? "border-cyan-500/60 bg-cyan-950/30 text-cyan-100"
                            : "border-white/10 text-slate-400 hover:bg-white/[0.03]"
                        }`}
                      >
                        <span className="block text-xs">{option.title}</span>
                        <span className="mt-1 block text-[10px] leading-relaxed opacity-70">
                          {option.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-cyan-700/50 bg-cyan-950/15 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-950/35 disabled:opacity-40"
                  >
                    {imageUrl ? "更換背景圖片" : "上傳背景圖片"}
                  </button>
                  {imageUrl && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={downloadCurrentImage}
                      className={panelButtonClass}
                    >
                      下載目前圖片
                    </button>
                  )}
                </div>

                <div className="text-[11px] leading-relaxed text-slate-500">
                  {imageUrl ? (
                    <span>目前圖片：{filename}（上傳新圖會直接覆蓋舊圖）</span>
                  ) : (
                    <span>支援 JPG、PNG、WEBP、GIF、AVIF，單張最多 20 MB。</span>
                  )}
                </div>

                {imageUrl && (
                  <div
                    className="relative h-28 overflow-hidden border border-white/10 bg-[#090b0c]"
                    aria-label="目前背景圖片預覽"
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url("${imageUrl}")`,
                        backgroundPosition: prefs.position,
                        backgroundSize: prefs.fit,
                        backgroundRepeat: "no-repeat",
                        opacity: prefs.opacity,
                        filter: `brightness(${prefs.brightness}) blur(${prefs.blur}px)`,
                      }}
                    />
                    <div className="pointer-events-none absolute bottom-2 right-2 bg-black/70 px-2 py-1 text-[10px] text-slate-300">
                      預覽
                    </div>
                  </div>
                )}

                <div className="space-y-4 border-t border-white/10 pt-4">
                  <div className="text-xs text-slate-300">自訂背景顯示效果</div>

                  <label className="block text-xs text-slate-400">
                    <span className="mb-2 flex justify-between">
                      <span>透明度</span>
                      <span>{Math.round(prefs.opacity * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="1"
                      disabled={busy}
                      value={Math.round(prefs.opacity * 100)}
                      onChange={(event) => updatePrefs({ opacity: Number(event.target.value) / 100 })}
                      className={inputRangeClass}
                    />
                  </label>

                  <label className="block text-xs text-slate-400">
                    <span className="mb-2 flex justify-between">
                      <span>亮度</span>
                      <span>{Math.round(prefs.brightness * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="35"
                      max="150"
                      step="5"
                      disabled={busy}
                      value={Math.round(prefs.brightness * 100)}
                      onChange={(event) => updatePrefs({ brightness: Number(event.target.value) / 100 })}
                      className={inputRangeClass}
                    />
                  </label>

                  <label className="block text-xs text-slate-400">
                    <span className="mb-2 flex justify-between">
                      <span>模糊程度</span>
                      <span>{prefs.blur}px</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="16"
                      step="1"
                      disabled={busy}
                      value={prefs.blur}
                      onChange={(event) => updatePrefs({ blur: Number(event.target.value) })}
                      className={inputRangeClass}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-slate-400">
                      <span className="mb-1.5 block">圖片顯示方式</span>
                      <select
                        value={prefs.fit}
                        disabled={busy}
                        onChange={(event) => updatePrefs({ fit: event.target.value === "contain" ? "contain" : "cover" })}
                        className="w-full border border-white/10 bg-[#171c1e] px-2 py-2 text-xs outline-none"
                      >
                        <option value="cover">填滿畫面（裁切）</option>
                        <option value="contain">完整顯示（留白）</option>
                      </select>
                    </label>
                    <label className="block text-xs text-slate-400">
                      <span className="mb-1.5 block">背景圖片位置</span>
                      <select
                        value={prefs.position}
                        disabled={busy}
                        onChange={(event) => updatePrefs({ position: event.target.value as AppearancePosition })}
                        className="w-full border border-white/10 bg-[#171c1e] px-2 py-2 text-xs outline-none"
                      >
                        {POSITIONS.map((position) => (
                          <option key={position.value} value={position.value}>
                            {position.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                {message && (
                  <p role="status" className="border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-cyan-100">
                    {message}
                  </p>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restoreDefault()}
                    className="border border-red-800/30 px-3 py-2 text-xs text-red-200/80 hover:bg-red-950/20 disabled:opacity-40"
                  >
                    恢復水墨預設
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    className={panelButtonClass}
                  >
                    {busy ? "儲存中…" : "完成"}
                  </button>
                </div>

                <p className="text-[10px] leading-relaxed text-slate-600">
                  自訂背景不會與筆記附件混在一起；目前的知識庫 ZIP 備份不包含此背景設定。
                  若要保留背景原圖，請使用「下載目前圖片」。
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
