"use client";

import { useEffect, useRef, useState } from "react";

import {
  CURSOR_CHANGED_EVENT,
  CURSOR_ROLES,
  DEFAULT_CURSOR_PREFERENCES,
  cursorBytesToBuffer,
  getCursorExtension,
  getSavedCursorTheme,
  normalizeIconBytes,
  parseAniCursor,
  readCursorPreferences,
  type CursorPreferences,
  type CursorRole,
  type CursorThemeAsset,
  type CursorThemeRecord,
} from "@/lib/obsidian/cursor";

interface PreparedCursor {
  frames: string[];
  delays: number[];
  isAni: boolean;
}

type PreparedTheme = Partial<Record<CursorRole, PreparedCursor>>;

function getMimeFromFilename(name: string): string {
  switch (getCursorExtension(name)) {
    case ".ani": return "application/x-navi-animation";
    case ".cur":
    case ".ico": return "image/x-icon";
    case ".png":
    case ".apng": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

async function prepareCursor(asset: CursorThemeAsset): Promise<PreparedCursor> {
  if (asset.kind === "ani" || /\.ani$/i.test(asset.filename)) {
    const frames = await parseAniCursor(asset.blob);
    return {
      frames: frames.map((frame) => URL.createObjectURL(frame.image)),
      delays: frames.map((frame) => frame.delayMs),
      isAni: true,
    };
  }
  if (/\.(cur|ico)$/i.test(asset.filename)) {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const icon = new Blob([cursorBytesToBuffer(normalizeIconBytes(bytes))], { type: "image/x-icon" });
    return { frames: [URL.createObjectURL(icon)], delays: [], isAni: false };
  }
  const blob = new Blob([asset.blob], { type: getMimeFromFilename(asset.filename) });
  return { frames: [URL.createObjectURL(blob)], delays: [], isAni: false };
}

function cssCursorToRole(value: string): CursorRole | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "auto") return null;
  return CURSOR_ROLES.includes(normalized as CursorRole) ? normalized as CursorRole : null;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const element = target.closest("textarea, input, [contenteditable='true'], [role='textbox']");
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    return ["text", "password", "search", "email", "url", "tel", "number", ""].includes(element.type);
  }
  return true;
}

/** 由 inline style、Tailwind cursor-* class、實際 CSS 與語意元素推斷操作狀態。 */
function inferCursorRole(target: EventTarget | null): CursorRole {
  let element = target instanceof Element ? target : null;
  const first = element;

  while (element && element !== document.documentElement) {
    if (element instanceof HTMLElement) {
      if (element.matches(":disabled, [aria-disabled='true']")) return "not-allowed";
      const dataRole = element.getAttribute("data-cursor-role");
      if (dataRole && CURSOR_ROLES.includes(dataRole as CursorRole)) return dataRole as CursorRole;

      const inlineRole = cssCursorToRole(element.style.cursor);
      if (inlineRole) return inlineRole;

      for (const rawClassName of Array.from(element.classList)) {
        // Tailwind 的 disabled:cursor-not-allowed 等變體也需要辨識。
        const className = rawClassName.split(":").pop() || rawClassName;
        if (!className.startsWith("cursor-")) continue;
        const classRole = cssCursorToRole(className.slice("cursor-".length));
        if (classRole) return classRole;
      }

      if (element.getAttribute("aria-busy") === "true") return "progress";
    }
    element = element.parentElement;
  }

  // 自訂游標啟用時 CSS 會暫時把游標設為 none。
  // 在同一個同步事件中短暫移除標記以讀取真正的 computed cursor，隨即恢復，不會經過畫面繪製。
  if (first instanceof Element) {
    const body = document.body;
    const wasOverlay = body.getAttribute("data-obsidian-cursor") === "overlay";
    if (wasOverlay) body.removeAttribute("data-obsidian-cursor");
    let computedCursor = "";
    try {
      computedCursor = window.getComputedStyle(first).cursor;
    } finally {
      if (wasOverlay) body.setAttribute("data-obsidian-cursor", "overlay");
    }
    const computedRole = cssCursorToRole(computedCursor);
    if (computedRole) return computedRole;

    if (first.closest("a, button, summary, select, [role='button'], [role='link'], .obsidian-wikilink, input[type='button'], input[type='submit'], input[type='reset']")) {
      return "pointer";
    }
    if (first.closest("[draggable='true']")) return "grab";
  }
  return "default";
}
/**
 * 常駐游標主題執行器。
 * 只在目前操作狀態有對應的自訂游標時隱藏原生游標；
 * 沒有對應圖示的狀態仍保留瀏覽器原生游標。
 */
export function CursorRuntime() {
  const [preferences, setPreferences] = useState<CursorPreferences>(DEFAULT_CURSOR_PREFERENCES);
  const [theme, setTheme] = useState<CursorThemeRecord | null>(null);
  const [prepared, setPrepared] = useState<PreparedTheme>({});
  const [activeRole, setActiveRole] = useState<CursorRole>("default");
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const preparedRef = useRef<PreparedTheme>({});
  const activeRoleRef = useRef<CursorRole>("default");
  const positionRef = useRef({ x: -200, y: -200 });

  useEffect(() => {
    let active = true;
    let requestNumber = 0;

    const reload = async () => {
      const id = ++requestNumber;
      const next = readCursorPreferences();
      try {
        const nextTheme = next.mode === "custom" ? await getSavedCursorTheme() : null;
        if (!active || requestNumber !== id) return;
        if (next.mode === "custom" && !nextTheme) {
          setPreferences({ ...next, mode: "system" });
          setTheme(null);
        } else {
          setPreferences(next);
          setTheme(nextTheme);
        }
      } catch (error) {
        if (!active || requestNumber !== id) return;
        console.warn("讀取自訂游標主題失敗：", error);
        setPreferences({ ...next, mode: "system" });
        setTheme(null);
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
    const createdUrls: string[] = [];
    preparedRef.current = {};
    setPrepared({});

    const load = async () => {
      if (preferences.mode !== "custom" || !theme) return;
      const next: PreparedTheme = {};
      for (const role of CURSOR_ROLES) {
        const asset = theme.cursors[role];
        if (!asset) continue;
        try {
          const cursor = await prepareCursor(asset);
          createdUrls.push(...cursor.frames);
          next[role] = cursor;
        } catch (error) {
          console.warn(`無法載入「${asset.filename}」(${role})：`, error);
        }
      }
      if (cancelled) {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      preparedRef.current = next;
      setPrepared(next);
    };

    void load();
    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [theme, preferences.mode]);

  const useOverlay = preferences.mode === "custom" && Object.keys(prepared).length > 0;

  useEffect(() => {
    const body = document.body;
    body.setAttribute("data-obsidian-cursor-text", preferences.preserveTextCursor ? "true" : "false");
    // 先保留原生游標；移到有自訂狀態的元素後，事件處理才隱藏原生游標。
    body.removeAttribute("data-obsidian-cursor");
    body.style.removeProperty("--obsidian-cursor-native");

    return () => {
      body.removeAttribute("data-obsidian-cursor");
      body.removeAttribute("data-obsidian-cursor-text");
      body.style.removeProperty("--obsidian-cursor-native");
    };
  }, [preferences.preserveTextCursor, useOverlay]);

  useEffect(() => {
    if (!useOverlay) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    let isTouch = false;
    let cachedTarget: Element | null = null;
    let cachedRole: CursorRole = "default";

    const resolve = (role: CursorRole) => prepared[role] || prepared.default || null;
    const roleForTarget = (target: EventTarget | null, force = false): CursorRole => {
      const element = target instanceof Element ? target : null;
      if (!force && element && element === cachedTarget) return cachedRole;
      cachedTarget = element;
      cachedRole = isTextInputTarget(target) ? "text" : inferCursorRole(target);
      return cachedRole;
    };

    const update = (x: number, y: number, target: EventTarget | null, visible: boolean, forceRole = false) => {
      positionRef.current = { x, y };
      overlay.style.left = `${x}px`;
      overlay.style.top = `${y}px`;

      if (!visible || document.hidden) {
        overlay.style.visibility = "hidden";
        document.body.removeAttribute("data-obsidian-cursor");
        return;
      }

      if (preferences.preserveTextCursor && isTextInputTarget(target)) {
        overlay.style.visibility = "hidden";
        document.body.removeAttribute("data-obsidian-cursor");
        return;
      }

      const role = roleForTarget(target, forceRole);
      const cursor = resolve(role);
      if (!cursor?.frames.length) {
        overlay.style.visibility = "hidden";
        document.body.removeAttribute("data-obsidian-cursor");
        return;
      }

      document.body.setAttribute("data-obsidian-cursor", "overlay");
      if (activeRoleRef.current !== role) {
        activeRoleRef.current = role;
        setActiveRole(role);
      }
      if (imageRef.current && imageRef.current.src !== cursor.frames[0]) {
        imageRef.current.src = cursor.frames[0];
      }
      overlay.style.visibility = "visible";
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
        isTouch = true;
        update(event.clientX, event.clientY, event.target, false);
        return;
      }
      isTouch = false;
      update(
        event.clientX,
        event.clientY,
        event.target,
        true,
        event.type === "pointerdown" || event.type === "pointerup"
      );
    };

    const onOver = (event: PointerEvent) => {
      if (isTouch) return;
      const { x, y } = positionRef.current;
      if (x >= 0 && y >= 0) update(x, y, event.target, true);
    };

    const onOut = (event: MouseEvent) => {
      if (!event.relatedTarget) {
        overlay.style.visibility = "hidden";
        document.body.removeAttribute("data-obsidian-cursor");
      }
    };

    const onHidden = () => {
      if (document.hidden) {
        overlay.style.visibility = "hidden";
        document.body.removeAttribute("data-obsidian-cursor");
      }
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("pointerup", onMove, { passive: true });
    document.addEventListener("mouseout", onOut, { passive: true });
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerup", onMove);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [useOverlay, prepared, preferences.preserveTextCursor]);

  useEffect(() => {
    const cursor = prepared[activeRole] || prepared.default;
    if (!useOverlay || !cursor?.frames.length || !cursor.isAni || cursor.frames.length <= 1) {
      if (cursor?.frames[0] && imageRef.current) imageRef.current.src = cursor.frames[0];
      return;
    }

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
      if (image) image.src = cursor.frames[index];
      const delay = cursor.delays[index] ?? 100;
      index = (index + 1) % cursor.frames.length;
      timeout = window.setTimeout(showNext, delay);
    };
    showNext();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [activeRole, prepared, useOverlay]);

  if (!useOverlay) return null;
  const hotspotX = Math.round(preferences.size * preferences.hotspotX / 100);
  const hotspotY = Math.round(preferences.size * preferences.hotspotY / 100);
  const activeCursor = prepared[activeRole] || prepared.default;

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
        src={activeCursor?.frames[0] || ""}
        alt=""
        draggable={false}
        className="obsidian-cursor-layer-image"
      />
    </div>
  );
}
