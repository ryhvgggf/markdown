"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  CURSOR_CHANGED_EVENT,
  DEFAULT_CURSOR_PREFERENCES,
  cursorBytesToBuffer,
  getSavedCursor,
  makeBuiltInCursorCss,
  normalizeIconBytes,
  parseAniCursor,
  readCursorPreferences,
  type CursorAssetRecord,
  type CursorPreferences,
} from "@/lib/obsidian/cursor";

interface PreparedCursor {
  frames: string[];
  delays: number[];
  isAni: boolean;
}

/**
 * 常駐元件：外觀設定視窗關閉後游標依舊有效。
 * 靜態內建樣式使用瀏覽器 CSS cursor；自訂/動態游標使用透明覆蓋層。
 * 覆蓋層不攔截點擊事件，滑鼠按鈕功能不會受到影響。
 */
export function CursorRuntime() {
  const [preferences, setPreferences] = useState<CursorPreferences>(DEFAULT_CURSOR_PREFERENCES);
  const [saved, setSaved] = useState<CursorAssetRecord | null>(null);
  const [prepared, setPrepared] = useState<PreparedCursor | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const positionRef = useRef({ x: -200, y: -200, visible: false });

  useEffect(() => {
    let active = true;
    let requestNumber = 0;

    const reload = async () => {
      const id = ++requestNumber;
      const next = readCursorPreferences();
      try {
        const asset = next.mode === "custom" ? await getSavedCursor() : null;
        if (!active || requestNumber !== id) return;
        setPreferences(next);
        setSaved((previous) => previous?.updatedAt === asset?.updatedAt && previous?.filename === asset?.filename
          ? previous : asset);
      } catch (error) {
        if (!active || requestNumber !== id) return;
        console.warn("讀取自訂游標失敗：", error);
        setPreferences({ ...next, mode: "system" });
        setSaved(null);
      }
    };

    void reload();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "web-obsidian-cursor-v1") void reload();
    };
    window.addEventListener(CURSOR_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);

    return () => {
      active = false;
      window.removeEventListener(CURSOR_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let createdUrls: string[] = [];
    setPrepared(null);

    const load = async () => {
      if (preferences.mode !== "custom" || !saved) return;
      try {
        let urls: string[];
        let delays: number[];
        if (saved.kind === "ani" || /\.ani$/i.test(saved.filename)) {
          const frames = await parseAniCursor(saved.blob);
          urls = frames.map((frame) => URL.createObjectURL(frame.image));
          delays = frames.map((frame) => frame.delayMs);
        } else if (/\.(cur|ico)$/i.test(saved.filename)) {
          const bytes = new Uint8Array(await saved.blob.arrayBuffer());
          const icon = new Blob([cursorBytesToBuffer(normalizeIconBytes(bytes))], { type: "image/x-icon" });
          urls = [URL.createObjectURL(icon)];
          delays = [];
        } else {
          const type = /\.gif$/i.test(saved.filename) ? "image/gif"
            : /\.webp$/i.test(saved.filename) ? "image/webp"
            : /\.apng$|\.png$/i.test(saved.filename) ? "image/png"
            : "image/jpeg";
          urls = [URL.createObjectURL(new Blob([saved.blob], { type }))];
          delays = [];
        }
        if (cancelled) {
          urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        createdUrls = urls;
        setPrepared({ frames: urls, delays, isAni: saved.kind === "ani" });
      } catch (error) {
        console.error("解析游標檔案失敗：", error);
        if (!cancelled) setPrepared(null);
      }
    };
    void load();

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [saved, preferences.mode]);

  const useOverlay = preferences.mode === "custom" && Boolean(prepared?.frames.length);

  const nativeCursor = useMemo(() => makeBuiltInCursorCss(preferences.mode, preferences.size), [
    preferences.mode, preferences.size,
  ]);

  useEffect(() => {
    const body = document.body;
    if (preferences.mode === "system" || (preferences.mode === "custom" && !useOverlay)) {
      body.removeAttribute("data-obsidian-cursor");
      body.style.removeProperty("--obsidian-cursor-native");
    } else {
      body.setAttribute("data-obsidian-cursor", useOverlay ? "overlay" : "preset");
      body.style.setProperty("--obsidian-cursor-native", nativeCursor);
    }
    body.setAttribute("data-obsidian-cursor-text", preferences.preserveTextCursor ? "true" : "false");

    return () => {
      body.removeAttribute("data-obsidian-cursor");
      body.removeAttribute("data-obsidian-cursor-text");
      body.style.removeProperty("--obsidian-cursor-native");
    };
  }, [preferences.mode, preferences.preserveTextCursor, useOverlay, nativeCursor]);

  useEffect(() => {
    if (!useOverlay) return;
    let isTouch = false;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const update = (x: number, y: number, visible: boolean) => {
      positionRef.current = { x, y, visible };
      overlay.style.left = `${x}px`;
      overlay.style.top = `${y}px`;
      overlay.style.visibility = visible ? "visible" : "hidden";
    };

    const isTextInput = (target: EventTarget | null): boolean => {
      if (!preferences.preserveTextCursor || !(target instanceof Element)) return false;
      const element = target.closest("textarea, input, [contenteditable='true'], [role='textbox']");
      if (!element) return false;
      if (element instanceof HTMLInputElement) {
        return ["text", "password", "search", "email", "url", "tel", "number", ""].includes(element.type);
      }
      return true;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
        isTouch = true;
        update(event.clientX, event.clientY, false);
        return;
      }
      isTouch = false;
      const show = !isTextInput(event.target) && !document.hidden;
      update(event.clientX, event.clientY, show);
    };
    const onOver = (event: PointerEvent) => {
      if (isTouch) return;
      const { x, y } = positionRef.current;
      update(x, y, !isTextInput(event.target) && !document.hidden);
    };
    const onOut = (event: MouseEvent) => {
      if (!event.relatedTarget) {
        const { x, y } = positionRef.current;
        update(x, y, false);
      }
    };
    const onHidden = () => {
      if (document.hidden) {
        const { x, y } = positionRef.current;
        update(x, y, false);
      }
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("mouseout", onOut, { passive: true });
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [useOverlay, preferences.preserveTextCursor]);

  useEffect(() => {
    if (!useOverlay || !prepared?.isAni || prepared.frames.length <= 1) return;
    let active = true;
    let index = 0;
    let timeout: number | undefined;

    const showNext = () => {
      if (!active) return;
      if (document.hidden) {
        timeout = window.setTimeout(showNext, 250);
        return;
      }
      const image = imageRef.current;
      if (image) image.src = prepared.frames[index];
      const ms = prepared.delays[index] ?? 100;
      index = (index + 1) % prepared.frames.length;
      timeout = window.setTimeout(showNext, ms);
    };
    showNext();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [useOverlay, prepared]);

  if (!useOverlay) return null;
  const hotspotX = Math.round(preferences.size * preferences.hotspotX / 100);
  const hotspotY = Math.round(preferences.size * preferences.hotspotY / 100);

  return (
    <div
      ref={overlayRef}
      className="obsidian-cursor-layer"
      style={{
        width: preferences.size,
        height: preferences.size,
        left: -200,
        top: -200,
        transform: `translate(${-hotspotX}px, ${-hotspotY}px)`,
        visibility: "hidden",
      }}
      aria-hidden="true"
    >
      <img
        ref={imageRef}
        src={prepared?.frames[0] || ""}
        alt=""
        draggable={false}
        className="obsidian-cursor-layer-image"
      />
    </div>
  );
}
