"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { CursorRuntime } from "@/components/obsidian/CursorRuntime";
import { CursorSettings } from "@/components/obsidian/CursorSettings";

import {
  ACCEPTED_IMAGE_TYPES,
  BACKGROUND_INFO,
  BACKGROUND_ZONES,
  DEFAULT_APPEARANCE,
  MAX_BACKGROUND_BYTES,
  deleteAllCustomBackgrounds,
  deleteCustomBackground,
  getCustomBackground,
  loadAppearancePreferences,
  migrateLegacyBackground,
  replaceCustomBackground,
  saveAppearancePreferences,
  type AppearancePreferences,
  type BackgroundRecord,
  type BackgroundZone,
} from "@/lib/obsidian/appearance";

interface BackgroundAsset {
  url: string;
  filename: string;
  blob: Blob;
}

type BackgroundAssetMap = Record<BackgroundZone, BackgroundAsset | null>;

type CropSource = {
  zone: BackgroundZone;
  file: File;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
};

type CropFocus = { x: number; y: number };

type FrameSize = { width: number; height: number };

type DragStart = {
  pointerId: number;
  clientX: number;
  clientY: number;
  focus: CropFocus;
};

const EMPTY_ASSETS: BackgroundAssetMap = {
  left: null,
  center: null,
  right: null,
};

const DEFAULT_IMAGE: Record<BackgroundZone, string> = {
  left: "/ink/left-mountain.png",
  center: "/ink/center-bamboo-forest.png",
  right: "/ink/right-plum-large.png",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失敗，請稍後再試";
}

/**
 * 預覽與輸出的裁切幾何使用完全相同的計算式。
 * zoom=1 表示「圖片至少填滿裁切框」，拖曳只移動可見範圍。
 */
function getCropGeometry(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom: number,
  focus: CropFocus
) {
  const coverScale = Math.max(
    frameWidth / sourceWidth,
    frameHeight / sourceHeight
  );
  const scale = coverScale * zoom;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const overflowX = Math.max(0, width - frameWidth);
  const overflowY = Math.max(0, height - frameHeight);

  return {
    width,
    height,
    overflowX,
    overflowY,
    left: -overflowX * focus.x,
    top: -overflowY * focus.y,
  };
}

function assetFromRecord(record: BackgroundRecord): BackgroundAsset {
  return {
    url: URL.createObjectURL(record.blob),
    filename: record.filename,
    blob: record.blob,
  };
}

export function AppearanceSettings() {
  const [open, setOpen] = useState(false);
  const [appearanceTab, setAppearanceTab] = useState<"background" | "cursor">("background");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedZone, setSelectedZone] = useState<BackgroundZone>("center");
  const [prefs, setPrefs] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [assets, setAssets] = useState<BackgroundAssetMap>(EMPTY_ASSETS);
  const [message, setMessage] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<CropSource | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropFocus, setCropFocus] = useState<CropFocus>({ x: 0.5, y: 0.5 });
  const [frameSize, setFrameSize] = useState<FrameSize>({ width: 0, height: 0 });
  const [cropError, setCropError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  const assetUrlsRef = useRef<Partial<Record<BackgroundZone, string>>>({});

  // 首次讀取時：將舊版單張背景搬到中間，並載入各欄原本的設定。
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const saved = loadAppearancePreferences();
      setPrefs(saved);

      try {
        await migrateLegacyBackground();
        const records = await Promise.all(
          BACKGROUND_ZONES.map((zone) => getCustomBackground(zone))
        );
        if (cancelled) return;

        const next = { ...EMPTY_ASSETS };
        for (let index = 0; index < BACKGROUND_ZONES.length; index++) {
          const record = records[index];
          const zone = BACKGROUND_ZONES[index];
          if (!record?.blob) continue;
          const asset = assetFromRecord(record);
          next[zone] = asset;
          assetUrlsRef.current[zone] = asset.url;
        }
        setAssets(next);
      } catch (error) {
        if (!cancelled) {
          console.error("讀取背景資料失敗：", error);
          setMessage(`背景圖片讀取失敗：${friendlyError(error)}`);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      for (const zone of BACKGROUND_ZONES) {
        const url = assetUrlsRef.current[zone];
        if (url) URL.revokeObjectURL(url);
      }
      assetUrlsRef.current = {};
    };
  }, []);

  // 關閉或更換裁切圖片時，釋放選檔預覽所產生的 Blob URL。
  useEffect(() => {
    if (!cropSource) return;
    return () => URL.revokeObjectURL(cropSource.url);
  }, [cropSource]);

  // CSS 每區都只覆寫對應 ::before；其他區仍顯示原水墨圖。
  useEffect(() => {
    if (!ready) return;
    const body = document.body;
    body.removeAttribute("data-appearance-mode"); // 清掉舊版全畫面模式

    for (const zone of BACKGROUND_ZONES) {
      const asset = assets[zone];
      const effect = prefs.effects[zone];
      const prefix = `--appearance-${zone}`;
      const attr = `data-appearance-${zone}`;

      if (asset) {
        body.setAttribute(attr, "custom");
        body.style.setProperty(`${prefix}-image`, `url("${asset.url}")`);
      } else {
        body.removeAttribute(attr);
        body.style.removeProperty(`${prefix}-image`);
      }

      body.style.setProperty(`${prefix}-opacity`, String(effect.opacity));
      body.style.setProperty(`${prefix}-brightness`, String(effect.brightness));
      body.style.setProperty(`${prefix}-blur`, `${effect.blur}px`);
    }

    try {
      saveAppearancePreferences(prefs);
    } catch (error) {
      console.warn("外觀設定寫入失敗：", error);
    }
  }, [assets, prefs, ready]);

  // 當裁切視窗開啟時，實測裁切框大小，圖片以 cover 比例顯示。
  useEffect(() => {
    if (!cropSource) return;
    const element = cropFrameRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width <= 0 || height <= 0) return;
      setFrameSize((old) =>
        Math.abs(old.width - width) < 0.5 && Math.abs(old.height - height) < 0.5
          ? old
          : { width, height }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cropSource]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (cropSource) setCropSource(null);
      else setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, cropSource, busy]);

  useEffect(() => {
    if (open && !cropSource) dialogRef.current?.focus();
  }, [open, cropSource]);

  const currentAsset = assets[selectedZone];
  const currentInfo = BACKGROUND_INFO[selectedZone];
  const currentEffect = prefs.effects[selectedZone];

  const cropGeometry = useMemo(() => {
    if (!cropSource || frameSize.width <= 0 || frameSize.height <= 0) return null;
    return getCropGeometry(
      cropSource.naturalWidth,
      cropSource.naturalHeight,
      frameSize.width,
      frameSize.height,
      cropZoom,
      cropFocus
    );
  }, [cropSource, frameSize, cropZoom, cropFocus]);

  const updateEffect = useCallback(
    (patch: Partial<AppearancePreferences["effects"][BackgroundZone]>) => {
      setPrefs((old) => ({
        effects: {
          ...old.effects,
          [selectedZone]: { ...old.effects[selectedZone], ...patch },
        },
      }));
    },
    [selectedZone]
  );

  async function onChooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;

    setMessage(null);
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setMessage("僅支援 JPG、PNG、WEBP、GIF、AVIF 圖片");
      return;
    }
    if (file.size <= 0 || file.size > MAX_BACKGROUND_BYTES) {
      setMessage("圖片不可為空白，且單張不可超過 20 MB");
      return;
    }

    const url = URL.createObjectURL(file);
    setBusy(true);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        throw new Error("無法判讀圖片長寬");
      }

      setCropZoom(1);
      setCropFocus({ x: 0.5, y: 0.5 });
      setFrameSize({ width: 0, height: 0 });
      setCropError(null);
      setCropSource({
        zone: selectedZone,
        file,
        url,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      setMessage(`讀取圖片失敗：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function onCropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropGeometry || busy || cropSource === null) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      focus: { ...cropFocus },
    };
  }

  function onCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId || !cropGeometry) return;

    const dx = event.clientX - start.clientX;
    const dy = event.clientY - start.clientY;
    setCropFocus({
      x: cropGeometry.overflowX > 0.001
        ? clamp(start.focus.x - dx / cropGeometry.overflowX, 0, 1)
        : 0.5,
      y: cropGeometry.overflowY > 0.001
        ? clamp(start.focus.y - dy / cropGeometry.overflowY, 0, 1)
        : 0.5,
    });
  }

  function onCropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function saveCroppedBackground() {
    if (busy || !cropSource || !cropGeometry || frameSize.width <= 0) return;
    setBusy(true);
    setCropError(null);

    try {
      const info = BACKGROUND_INFO[cropSource.zone];
      const img = new Image();
      img.src = cropSource.url;
      await img.decode();

      const canvas = document.createElement("canvas");
      canvas.width = info.width;
      canvas.height = info.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("瀏覽器不支援圖片裁切");

      const factorX = info.width / frameSize.width;
      const factorY = info.height / frameSize.height;
      context.drawImage(
        img,
        cropGeometry.left * factorX,
        cropGeometry.top * factorY,
        cropGeometry.width * factorX,
        cropGeometry.height * factorY
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("裁切圖片輸出失敗")),
          "image/webp",
          0.92
        );
      });

      const isWebp = blob.type === "image/webp";
      const ext = isWebp ? ".webp" : ".png";
      const basename = cropSource.file.name.replace(/\.[^.]+$/, "") || "background";
      const filename = `${basename}-${cropSource.zone}-crop${ext}`;

      // 先確保 IndexedDB 寫入成功，再撤下舊圖。
      await replaceCustomBackground(cropSource.zone, blob, filename);
      const nextUrl = URL.createObjectURL(blob);
      const oldUrl = assetUrlsRef.current[cropSource.zone];
      assetUrlsRef.current[cropSource.zone] = nextUrl;
      setAssets((prev) => ({
        ...prev,
        [cropSource.zone]: { url: nextUrl, filename, blob },
      }));
      if (oldUrl) {
        // 等下一幀換完畫面再釋放舊網址。
        window.requestAnimationFrame(() => URL.revokeObjectURL(oldUrl));
      }

      setMessage(`已更新「${info.title}」，原本此區圖片已被取代。`);
      setCropSource(null);
    } catch (error) {
      setCropError(`套用失敗：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelected() {
    if (busy || !currentAsset) return;
    if (!window.confirm(`要恢復「${currentInfo.title}」的水墨預設圖片嗎？\n\n目前這一區的自訂圖將被刪除，另外兩區不受影響。`)) return;

    setBusy(true);
    setMessage(null);
    try {
      await deleteCustomBackground(selectedZone);
      const oldUrl = assetUrlsRef.current[selectedZone];
      delete assetUrlsRef.current[selectedZone];
      setAssets((prev) => ({ ...prev, [selectedZone]: null }));
      if (oldUrl) window.requestAnimationFrame(() => URL.revokeObjectURL(oldUrl));
      setMessage(`「${currentInfo.title}」已恢復水墨預設，其他區域沒有變更。`);
    } catch (error) {
      setMessage(`恢復失敗：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restoreAll() {
    if (busy) return;
    if (!window.confirm("確定恢復左側、中間、右側全部的水墨預設背景嗎？\n\n三區已上傳的圖片都會從本機刪除。")) return;

    setBusy(true);
    setMessage(null);
    try {
      await deleteAllCustomBackgrounds();
      const oldUrls = BACKGROUND_ZONES
        .map((zone) => assetUrlsRef.current[zone])
        .filter((value): value is string => Boolean(value));
      assetUrlsRef.current = {};
      setAssets({ ...EMPTY_ASSETS });
      setPrefs({
        effects: {
          left: { ...DEFAULT_APPEARANCE.effects.left },
          center: { ...DEFAULT_APPEARANCE.effects.center },
          right: { ...DEFAULT_APPEARANCE.effects.right },
        },
      });
      window.requestAnimationFrame(() => oldUrls.forEach((url) => URL.revokeObjectURL(url)));
      setMessage("三區已恢復原本水墨背景，並清除全部自訂背景檔。 ");
    } catch (error) {
      setMessage(`恢復失敗：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function downloadSelected() {
    if (!currentAsset) return;
    const anchor = document.createElement("a");
    anchor.href = currentAsset.url;
    anchor.download = currentAsset.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const buttonClass =
    "border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      {/* 全站常駐游標：關閉設定視窗後仍生效。 */}
      <CursorRuntime />
      <input
        ref={inputRef}
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
        title="外觀設定：背景圖片與滑鼠游標"
      >
        <span aria-hidden="true">⚙</span>
        <span>外觀設定</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="appearance-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy && !cropSource) setOpen(false);
          }}
        >
          <div
            className="appearance-dialog outline-none"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="appearance-dialog-title"
            tabIndex={-1}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <h2 id="appearance-dialog-title" className="font-serif text-base text-white">
                  外觀設定
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  三區背景、滑鼠游標皆可自訂，設定僅保存在目前瀏覽器
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

            <div className="flex border-b border-white/10 text-xs">
              <button
                type="button"
                className={`flex-1 px-4 py-3 ${appearanceTab === "background" ? "border-b-2 border-cyan-500 text-cyan-100" : "text-slate-400 hover:text-white"}`}
                aria-pressed={appearanceTab === "background"}
                onClick={() => setAppearanceTab("background")}
              >
                背景圖片
              </button>
              <button
                type="button"
                className={`flex-1 px-4 py-3 ${appearanceTab === "cursor" ? "border-b-2 border-cyan-500 text-cyan-100" : "text-slate-400 hover:text-white"}`}
                aria-pressed={appearanceTab === "cursor"}
                onClick={() => setAppearanceTab("cursor")}
              >
                滑鼠游標
              </button>
            </div>

            {appearanceTab === "background" ? (
            <div className="space-y-5 p-5">
              <div>
                <h3 className="mb-2 text-xs text-slate-300">選擇要更換的背景區域</h3>
                <div className="grid grid-cols-3 gap-2">
                  {BACKGROUND_ZONES.map((zone) => {
                    const info = BACKGROUND_INFO[zone];
                    const selected = zone === selectedZone;
                    const asset = assets[zone];
                    return (
                      <button
                        key={zone}
                        type="button"
                        disabled={busy}
                        aria-pressed={selected}
                        onClick={() => { setSelectedZone(zone); setMessage(null); }}
                        className={`min-w-0 border p-2 text-left disabled:opacity-40 ${
                          selected
                            ? "border-cyan-500/70 bg-cyan-950/25 text-cyan-100"
                            : "border-white/10 text-slate-400 hover:border-white/30"
                        }`}
                      >
                        <div
                          className="mb-2 h-16 w-full border border-white/5 bg-[#090b0c] bg-cover bg-center"
                          style={{
                            backgroundImage: `url("${asset?.url || DEFAULT_IMAGE[zone]}")`,
                          }}
                        />
                        <span className="block text-xs font-medium">{info.title}</span>
                        <span className="mt-1 block text-[10px] opacity-65">
                          {asset ? "已自訂" : "水墨預設"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border border-white/10 bg-white/[0.025] px-3 py-3 text-xs leading-relaxed">
                <div className="font-medium text-cyan-200">目前選取：{currentInfo.title}</div>
                <p className="mt-1 text-slate-400">
                  此圖片建議使用 <strong className="text-slate-200">
                    {currentInfo.width} × {currentInfo.height} px（寬 × 高）
                  </strong>，作為「{currentInfo.description}」的背景。
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  這是建議尺寸，不是上傳限制；確認前可拖曳圖片調整可見範圍。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                  className="border border-cyan-700/50 bg-cyan-950/15 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-950/35 disabled:opacity-40"
                >
                  {currentAsset ? `更換${currentInfo.title}` : `上傳${currentInfo.title}`}
                </button>
                {currentAsset && (
                  <>
                    <button type="button" onClick={downloadSelected} className={buttonClass}>
                      下載目前圖片
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreSelected()}
                      className={buttonClass}
                    >
                      恢復此區預設
                    </button>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {currentAsset
                  ? `目前圖片：${currentAsset.filename}（更換後舊圖不會留在資料庫）`
                  : "目前使用水墨預設背景。支援 JPG、PNG、WEBP、GIF、AVIF；單張最多 20 MB。"}
              </p>

              {currentAsset && (
                <div className="relative h-32 overflow-hidden border border-white/10 bg-[#090b0c]">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url("${currentAsset.url}")`,
                      opacity: currentEffect.opacity,
                      filter: `brightness(${currentEffect.brightness}) blur(${currentEffect.blur}px)`,
                    }}
                  />
                  <div className="pointer-events-none absolute bottom-2 right-2 bg-black/70 px-2 py-1 text-[10px] text-slate-300">
                    已套用的背景預覽
                  </div>
                </div>
              )}

              <div className="space-y-4 border-t border-white/10 pt-4">
                <h3 className="text-xs text-slate-300">{currentInfo.title}的顯示效果</h3>

                <label className="block text-xs text-slate-400">
                  <span className="mb-2 flex justify-between">
                    <span>透明度</span>
                    <span>{Math.round(currentEffect.opacity * 100)}%</span>
                  </span>
                  <input
                    type="range" min="5" max="100" step="1"
                    disabled={busy}
                    value={Math.round(currentEffect.opacity * 100)}
                    onChange={(event) => updateEffect({ opacity: Number(event.target.value) / 100 })}
                    className="w-full"
                  />
                </label>

                <label className="block text-xs text-slate-400">
                  <span className="mb-2 flex justify-between">
                    <span>亮度</span>
                    <span>{Math.round(currentEffect.brightness * 100)}%</span>
                  </span>
                  <input
                    type="range" min="35" max="150" step="5"
                    disabled={busy}
                    value={Math.round(currentEffect.brightness * 100)}
                    onChange={(event) => updateEffect({ brightness: Number(event.target.value) / 100 })}
                    className="w-full"
                  />
                </label>

                <label className="block text-xs text-slate-400">
                  <span className="mb-2 flex justify-between">
                    <span>模糊程度</span>
                    <span>{currentEffect.blur}px</span>
                  </span>
                  <input
                    type="range" min="0" max="16" step="1"
                    disabled={busy}
                    value={currentEffect.blur}
                    onChange={(event) => updateEffect({ blur: Number(event.target.value) })}
                    className="w-full"
                  />
                </label>
              </div>

              {message && (
                <p role="status" className="border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-cyan-100">
                  {message}
                </p>
              )}

              <div className="flex justify-between gap-3 border-t border-white/10 pt-4">
                <button
                  type="button" disabled={busy}
                  onClick={() => void restoreAll()}
                  className="border border-red-800/30 px-3 py-2 text-xs text-red-200/80 hover:bg-red-950/20 disabled:opacity-40"
                >
                  三區全部恢復預設
                </button>
                <button type="button" disabled={busy} onClick={() => setOpen(false)} className={buttonClass}>
                  完成
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-600">
                背景圖片會裁切後儲存在獨立 IndexedDB，每一區僅保留一張；不會增加筆記附件數量。
                GIF 動圖經裁切後會變成靜態圖片。知識庫 ZIP 備份目前不包含背景圖片。
              </p>
            </div>
            ) : (
              <CursorSettings />
            )}
          </div>
        </div>,
        document.body
      )}

      {cropSource && open && typeof document !== "undefined" && createPortal(
        <div className="appearance-dialog-backdrop" style={{ zIndex: 16500 }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`裁切${BACKGROUND_INFO[cropSource.zone].title}`}
            className="appearance-crop-dialog outline-none"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <h3 className="font-serif text-base text-white">拖曳調整圖片顯示範圍</h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  {BACKGROUND_INFO[cropSource.zone].title} · 建議 {BACKGROUND_INFO[cropSource.zone].width} × {BACKGROUND_INFO[cropSource.zone].height} px
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label="取消裁切"
                onClick={() => setCropSource(null)}
                className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-40"
              >✕</button>
            </div>

            <div className="space-y-4 p-4">
              <p className="text-center text-xs leading-relaxed text-slate-400">
                在框內用滑鼠或手指拖動圖片，調整要保留的位置。框內就是最後會顯示的區域。
              </p>

              <div
                ref={cropFrameRef}
                className="appearance-crop-frame"
                style={{
                  aspectRatio: `${BACKGROUND_INFO[cropSource.zone].width} / ${BACKGROUND_INFO[cropSource.zone].height}`,
                  width: cropSource.zone === "center" ? "100%" : "min(100%, 280px)",
                }}
                onPointerDown={onCropPointerDown}
                onPointerMove={onCropPointerMove}
                onPointerUp={onCropPointerUp}
                onPointerCancel={onCropPointerUp}
              >
                {cropGeometry && (
                  <img
                    src={cropSource.url}
                    alt="圖片裁切預覽"
                    draggable={false}
                    style={{
                      position: "absolute",
                      left: cropGeometry.left,
                      top: cropGeometry.top,
                      width: cropGeometry.width,
                      height: cropGeometry.height,
                      maxWidth: "none",
                      maxHeight: "none",
                    }}
                  />
                )}
                {/* 輕微的三分線，協助使用者構圖。 */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30">
                  {Array.from({ length: 9 }, (_, index) => (
                    <div key={index} className="border border-white/20" />
                  ))}
                </div>
              </div>

              <label className="block text-xs text-slate-400">
                <span className="mb-2 flex items-center justify-between">
                  <span>圖片縮放</span>
                  <span>{Math.round(cropZoom * 100)}%</span>
                </span>
                <input
                  type="range" min="1" max="3" step="0.05"
                  disabled={busy}
                  value={cropZoom}
                  onChange={(event) => setCropZoom(Number(event.target.value))}
                  className="w-full"
                />
              </label>

              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  原圖：{cropSource.naturalWidth} × {cropSource.naturalHeight} px
                </span>
                <button
                  type="button" disabled={busy}
                  className="border border-white/15 px-3 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-40"
                  onClick={() => {
                    setCropZoom(1);
                    setCropFocus({ x: 0.5, y: 0.5 });
                  }}
                >
                  圖片置中
                </button>
              </div>

              {cropError && (
                <p role="alert" className="border border-red-800/30 px-3 py-2 text-xs text-red-300">
                  {cropError}
                </p>
              )}

              <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                <button
                  type="button" disabled={busy}
                  onClick={() => setCropSource(null)}
                  className={buttonClass}
                >取消</button>
                <button
                  type="button" disabled={busy || !cropGeometry}
                  onClick={() => void saveCroppedBackground()}
                  className="border border-cyan-700/50 bg-cyan-950/25 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-950/40 disabled:opacity-40"
                >
                  {busy ? "處理中…" : "確認裁切並套用"}
                </button>
              </div>
              <p className="text-[10px] text-slate-600">
                按下「確認裁切並套用」才會真正取代此區的舊圖片；取消不會更動背景資料庫。
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
