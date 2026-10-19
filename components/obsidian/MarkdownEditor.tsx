"use client";

import DOMPurify from "dompurify";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MediaManagerPanel } from "@/components/obsidian/MediaManagerPanel";

import {
  deleteSavedMedia,
  getMediaDetails,
  resolveMediaUrl,
  revokeAllActiveMediaUrls,
  saveUploadedMedia,
} from "@/lib/obsidian/media";

import { renderMarkdownToHtml } from "@/lib/obsidian/parser";
import { Note, ViewMode } from "@/lib/obsidian/types";

interface MarkdownEditorProps {
  note: Note | null;
  existingTitles: string[];
  targetHeadingSlug?: string | null;
  onClearTargetHeadingSlug?: () => void;
  onUpdateContent: (content: string) => void;
  onNavigateToNoteTitle: (title: string, headingSlug?: string) => void;
  onDownloadMarkdown: (note: Note) => void;
  onOpenGraphView: () => void;
  onSelectTag?: (tag: string) => void;
}

type ListStyle =
  | "bullet"
  | "decimal-dot"
  | "decimal-paren"
  | "lower-alpha-paren"
  | "upper-alpha-paren"
  | "lower-roman"
  | "upper-roman"
  | "cn-ideographic"
  | "cn-parentheses"
  | "cn-heavenly"
  | "cn-earthly"
  | "task";

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

function numberToAlpha(value: number): string {
  let n = Math.max(1, value);
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function alphaToNumber(value: string): number {
  let result = 0;
  for (const char of value.toLowerCase()) {
    result = result * 26 + char.charCodeAt(0) - 96;
  }
  return Math.max(1, result);
}

function numberToRoman(value: number): string {
  const pairs: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let n = Math.max(1, Math.min(3999, value));
  let result = "";
  for (const [amount, symbol] of pairs) {
    while (n >= amount) {
      result += symbol;
      n -= amount;
    }
  }
  return result;
}

function romanToNumber(value: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const text = value.toUpperCase();
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    const current = values[text[index]] || 0;
    const next = values[text[index + 1]] || 0;
    total += current < next ? -current : current;
  }
  return Math.max(1, total);
}

function numberToChinese(value: number): string {
  const n = Math.floor(value);
  if (n <= 0) return "一";
  if (n > 9999) return String(n);
  const units = ["", "十", "百", "千"];
  const digits = String(n);
  let result = "";
  let pendingZero = false;

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const place = digits.length - index - 1;
    if (digit === 0) {
      if (result && digits.slice(index + 1).split("").some((item) => item !== "0")) {
        pendingZero = true;
      }
      continue;
    }
    if (pendingZero) {
      result += "零";
      pendingZero = false;
    }
    if (!(place === 1 && digit === 1 && index === 0)) result += CHINESE_DIGITS[digit];
    result += units[place];
  }
  return result || "一";
}

function chineseToNumber(value: string): number {
  const digitMap: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in digitMap) current = digitMap[char];
    else if (char in unitMap) {
      total += (current || 1) * unitMap[char];
      current = 0;
    }
  }
  return Math.max(1, total + current);
}

function nextListMarker(marker: string): string {
  if (/^\d+[.)]$/.test(marker)) {
    return `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}`;
  }

  if (/^[a-z]+\)$/i.test(marker)) {
    const current = marker.slice(0, -1);
    const next = numberToAlpha(alphaToNumber(current) + 1);
    return `${current === current.toUpperCase() ? next.toUpperCase() : next})`;
  }

  if (/^[ivxlcdm]+\.$/i.test(marker)) {
    const current = marker.slice(0, -1);
    const next = numberToRoman(romanToNumber(current) + 1);
    return `${current === current.toUpperCase() ? next : next.toLowerCase()}.`;
  }

  const chineseParen = /^(（|\()([一二三四五六七八九十百千零〇兩两]+)(）|\))$/.exec(marker);
  if (chineseParen) {
    const next = numberToChinese(chineseToNumber(chineseParen[2]) + 1);
    return `${chineseParen[1]}${next}${chineseParen[3]}`;
  }

  const chineseNumber = /^([一二三四五六七八九十百千零〇兩两]+)([、.])$/.exec(marker);
  if (chineseNumber) {
    return `${numberToChinese(chineseToNumber(chineseNumber[1]) + 1)}${chineseNumber[2]}`;
  }

  const stem = /^([甲乙丙丁戊己庚辛壬癸])([、.])$/.exec(marker);
  if (stem) {
    const index = HEAVENLY_STEMS.indexOf(stem[1]);
    return `${HEAVENLY_STEMS[(index + 1) % HEAVENLY_STEMS.length]}${stem[2]}`;
  }

  const branch = /^([子丑寅卯辰巳午未申酉戌亥])([、.])$/.exec(marker);
  if (branch) {
    const index = EARTHLY_BRANCHES.indexOf(branch[1]);
    return `${EARTHLY_BRANCHES[(index + 1) % EARTHLY_BRANCHES.length]}${branch[2]}`;
  }

  return marker;
}

function stripExistingListMarker(line: string): { indent: string; content: string } {
  const indent = /^[ \t]*/.exec(line)?.[0] || "";
  const body = line.slice(indent.length);
  const markerPattern = /^(?:[-+*]|\d+[.)]|[a-zA-Z]+\)|[ivxlcdm]+\.|（[一二三四五六七八九十百千零〇兩两]+）|\([一二三四五六七八九十百千零〇兩两]+\)|[一二三四五六七八九十百千零〇兩两]+[、.]|[甲乙丙丁戊己庚辛壬癸][、.]|[子丑寅卯辰巳午未申酉戌亥][、.])\s*(?:\[([ xX])\]\s+)?/i;
  return { indent, content: body.replace(markerPattern, "") };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFileIcon(fileType: string): string {
  switch (fileType) {
    case "pdf":
      return "PDF";
    case "excel":
      return "XLS";
    case "doc":
      return "DOC";
    case "ppt":
      return "PPT";
    case "archive":
      return "ZIP";
    case "audio":
      return "AUD";
    case "video":
      return "VID";
    case "image":
      return "IMG";
    default:
      return "FILE";
  }
}

export function MarkdownEditor({
  note,
  existingTitles,
  targetHeadingSlug,
  onClearTargetHeadingSlug,
  onUpdateContent,
  onNavigateToNoteTitle,
  onDownloadMarkdown,
  onOpenGraphView,
  onSelectTag,
}: MarkdownEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [listStyleValue, setListStyleValue] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sanitizedHtml, setSanitizedHtml] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      revokeAllActiveMediaUrls();
    };
  }, [note?.id]);

  const rawHtml = useMemo(() => {
    if (!note) return "";

    return renderMarkdownToHtml(
      note.content,
      existingTitles,
      note.title
    );
  }, [note?.content, note?.title, existingTitles]);

  /**
   * Security:
   * 所有 parser 產生的 HTML 都先過 DOMPurify，
   * 再交給 dangerouslySetInnerHTML。
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      setSanitizedHtml("");
      return;
    }

    const clean = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: [
        "data-media-id",
        "data-media-name",
        "data-media-type",
        "data-note-title",
        "data-heading-target",
        "data-heading-slug",
        "data-tag",
        "data-list-marker",
      ],
    });

    setSanitizedHtml(clean);
  }, [rawHtml]);

  const scrollToHeading = useCallback((slug: string) => {
    if (!previewRef.current || !slug) return;

    let target: HTMLElement | null = null;

    const byId = document.getElementById(slug);

    if (byId && previewRef.current.contains(byId)) {
      target = byId;
    }

    if (!target && typeof CSS !== "undefined" && CSS.escape) {
      target = previewRef.current.querySelector<HTMLElement>(
        `#${CSS.escape(slug)}`
      );
    }

    if (!target) {
      target = previewRef.current.querySelector<HTMLElement>(
        `[data-heading-slug="${slug.replace(/"/g, '\\"')}"]`
      );
    }

    if (!target) return;

    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    target.classList.add(
      "ring-1",
      "ring-cyan-500/50",
      "bg-cyan-950/20"
    );

    window.setTimeout(() => {
      target?.classList.remove(
        "ring-1",
        "ring-cyan-500/50",
        "bg-cyan-950/20"
      );
    }, 1800);
  }, []);

  useEffect(() => {
    if (!targetHeadingSlug || !note) return;

    const timer = window.setTimeout(() => {
      scrollToHeading(targetHeadingSlug);
      onClearTargetHeadingSlug?.();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    targetHeadingSlug,
    note?.id,
    sanitizedHtml,
    scrollToHeading,
    onClearTargetHeadingSlug,
  ]);

  /**
   * 將 IndexedDB Blob 安全地掛進 Preview。
   * 這裡不使用 innerHTML，避免重新引入 XSS。
   */
  useEffect(() => {
    if (!previewRef.current || !note) return;

    let cancelled = false;
    const root = previewRef.current;

    const nodes = root.querySelectorAll<HTMLElement>(
      ".obsidian-media-container[data-media-id]"
    );

    const renderMedia = async (el: HTMLElement) => {
      const ref = el.dataset.mediaId || "";
      const hintedName = el.dataset.mediaName || ref;
      const hintedType = el.dataset.mediaType || "file";

      if (!ref) return;

      try {
        const [record, objectUrl] = await Promise.all([
          getMediaDetails(ref),
          resolveMediaUrl(ref),
        ]);

        if (cancelled || !el.isConnected) return;

        const displayName = record?.filename || hintedName || ref;
        const fileType = hintedType;

        el.replaceChildren();

        if (!objectUrl) {
          const missing = document.createElement("div");
          missing.className =
            "inline-flex items-center gap-2 rounded border border-amber-700/40 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-300";

          const text = document.createElement("span");
          text.textContent = `附件「${displayName}」不存在於本機庫`;

          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className =
            "rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white";
          removeButton.textContent = "移除引用";
          removeButton.dataset.mediaDeleteRef = ref;
          removeButton.dataset.mediaDeleteName = displayName;

          missing.append(text, removeButton);
          el.appendChild(missing);
          return;
        }

        const shell = document.createElement("div");
        shell.className =
          "relative group/media my-2 inline-block max-w-full";

        const actions = document.createElement("div");
        actions.className =
          "absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/media:opacity-100";

        const download = document.createElement("a");
        download.href = objectUrl;
        download.download = displayName;
        download.className =
          "rounded border border-white/10 bg-black/70 px-2 py-1 text-[10px] text-slate-200 backdrop-blur-sm hover:bg-black/90";
        download.textContent = "下載";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className =
          "rounded border border-red-500/20 bg-black/70 px-2 py-1 text-[10px] text-red-300 backdrop-blur-sm hover:bg-red-950/80 hover:text-red-200";
        deleteButton.textContent = "刪除";
        deleteButton.dataset.mediaDeleteRef = ref;
        deleteButton.dataset.mediaDeleteName = displayName;

        actions.append(download, deleteButton);

        if (fileType === "image") {
          const image = document.createElement("img");
          image.src = objectUrl;
          image.alt = displayName;
          image.className =
            "max-h-96 max-w-full rounded object-contain border border-white/10 shadow-sm";

          shell.append(image, actions);
          el.appendChild(shell);
          return;
        }

        if (fileType === "video") {
          const video = document.createElement("video");
          video.src = objectUrl;
          video.controls = true;
          video.className =
            "max-h-96 max-w-full rounded border border-white/10 shadow-sm";

          shell.append(video, actions);
          el.appendChild(shell);
          return;
        }

        if (fileType === "audio") {
          const audioShell = document.createElement("div");
          audioShell.className =
            "flex max-w-md items-center gap-3 rounded border border-white/10 bg-black/25 p-3";

          const audio = document.createElement("audio");
          audio.src = objectUrl;
          audio.controls = true;
          audio.className = "h-9 max-w-xs";

          const name = document.createElement("span");
          name.className =
            "min-w-0 flex-1 truncate text-xs text-slate-300";
          name.textContent = displayName;

          audioShell.append(audio, name, download, deleteButton);
          el.appendChild(audioShell);
          return;
        }

        const card = document.createElement("div");
        card.className =
          "flex max-w-md items-center justify-between gap-3 rounded border border-white/10 bg-black/25 p-3";

        const left = document.createElement("div");
        left.className = "flex min-w-0 items-center gap-3";

        const icon = document.createElement("div");
        icon.className =
          "flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[9px] font-mono text-slate-400";
        icon.textContent = getFileIcon(fileType);

        const meta = document.createElement("div");
        meta.className = "min-w-0";

        const name = document.createElement("div");
        name.className = "truncate text-xs text-slate-200";
        name.textContent = displayName;

        const sub = document.createElement("div");
        sub.className =
          "mt-0.5 text-[9px] uppercase tracking-wide text-slate-500";
        sub.textContent = "本機附件";

        meta.append(name, sub);
        left.append(icon, meta);

        const cardActions = document.createElement("div");
        cardActions.className = "flex shrink-0 items-center gap-1";
        cardActions.append(download, deleteButton);

        card.append(left, cardActions);
        el.appendChild(card);
      } catch (error) {
        console.error("載入附件失敗:", ref, error);

        if (!cancelled && el.isConnected) {
          el.textContent = `載入失敗：${hintedName}`;
        }
      }
    };

    nodes.forEach((el) => {
      void renderMedia(el);
    });

    return () => {
      cancelled = true;
    };
  }, [sanitizedHtml, note?.id]);

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-transparent p-6 text-center text-slate-400">
        <div className="mb-3 font-serif text-2xl text-slate-500">墨</div>
        <h3 className="font-serif text-base text-slate-200">
          未選取任何筆記
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          請從左側選取筆記，或建立一篇新筆記。
        </p>
      </div>
    );
  }

  const insertFormatting = (
    prefix: string,
    suffix: string = ""
  ) => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const body = selected || "文字";
    const replacement = `${prefix}${body}${suffix}`;

    onUpdateContent(
      text.substring(0, start) +
        replacement +
        text.substring(end)
    );

    window.setTimeout(() => {
      textarea.focus();

      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + body.length
      );
    }, 0);
  };

  const insertTextAtCursor = (insertion: string) => {
    const textarea = textareaRef.current;

    if (!textarea) {
      onUpdateContent(
        note.content +
          (note.content.endsWith("\n") ? "" : "\n") +
          insertion
      );
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    onUpdateContent(
      text.substring(0, start) +
        insertion +
        text.substring(end)
    );

    window.setTimeout(() => {
      textarea.focus();

      const next = start + insertion.length;
      textarea.setSelectionRange(next, next);
    }, 0);
  };

  /** 將選取行或游標所在行套用 Markdown 區塊前綴。 */
  const applyLinePrefix = (
    prefix: string | ((line: string, index: number) => string)
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineBreak = value.indexOf("\n", effectiveEnd);
    const lineEnd = lineBreak === -1 ? value.length : lineBreak;
    const block = value.slice(lineStart, lineEnd);
    const replacement = block
      .split("\n")
      .map((line, index) => {
        const linePrefix = typeof prefix === "function" ? prefix(line, index) : prefix;
        return `${linePrefix}${line}`;
      })
      .join("\n");

    onUpdateContent(value.slice(0, lineStart) + replacement + value.slice(lineEnd));

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    }, 0);
  };

  /** 類似 Word 的清單樣式：一次替選取行／目前行套用指定編號。 */
  const applyListStyle = (style: ListStyle) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineBreak = value.indexOf("\n", effectiveEnd);
    const lineEnd = lineBreak === -1 ? value.length : lineBreak;
    const selectedBlock = value.slice(lineStart, lineEnd);
    const lines = selectedBlock.split("\n");

    const replacement = lines.map((line, index) => {
      const { indent, content } = stripExistingListMarker(line);
      let prefix = "";

      switch (style) {
        case "bullet":
          prefix = "- ";
          break;
        case "decimal-dot":
          prefix = `${index + 1}. `;
          break;
        case "decimal-paren":
          prefix = `${index + 1}) `;
          break;
        case "lower-alpha-paren":
          prefix = `${numberToAlpha(index + 1)}) `;
          break;
        case "upper-alpha-paren":
          prefix = `${numberToAlpha(index + 1).toUpperCase()}) `;
          break;
        case "lower-roman":
          prefix = `${numberToRoman(index + 1).toLowerCase()}. `;
          break;
        case "upper-roman":
          prefix = `${numberToRoman(index + 1)}. `;
          break;
        case "cn-ideographic":
          prefix = `${numberToChinese(index + 1)}、 `;
          break;
        case "cn-parentheses":
          prefix = `（${numberToChinese(index + 1)}） `;
          break;
        case "cn-heavenly":
          prefix = `${HEAVENLY_STEMS[index % HEAVENLY_STEMS.length]}、 `;
          break;
        case "cn-earthly":
          prefix = `${EARTHLY_BRANCHES[index % EARTHLY_BRANCHES.length]}、 `;
          break;
        case "task":
          prefix = "- [ ] ";
          break;
      }

      return `${indent}${prefix}${content}`;
    }).join("\n");

    onUpdateContent(value.slice(0, lineStart) + replacement + value.slice(lineEnd));

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    }, 0);
  };

  /** 插入一般 Markdown 連結，並選取網址方便直接修改。 */
  const insertLink = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const label = selected || "連結文字";
    const url = "https://example.com";
    const replacement = `[${label}](${url})`;

    onUpdateContent(value.slice(0, start) + replacement + value.slice(end));

    window.setTimeout(() => {
      textarea.focus();
      const urlStart = start + label.length + 3;
      textarea.setSelectionRange(urlStart, urlStart + url.length);
    }, 0);
  };

  /** Markdown 常用快捷鍵、Tab 縮排，以及 Enter 自動延續清單／引用。 */
  const handleEditorKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    const textarea = event.currentTarget;
    const isMod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (isMod && !event.altKey && !event.shiftKey && key === "b") {
      event.preventDefault();
      insertFormatting("**", "**");
      return;
    }

    if (isMod && !event.altKey && !event.shiftKey && key === "i") {
      event.preventDefault();
      insertFormatting("*", "*");
      return;
    }

    if (isMod && !event.altKey && event.shiftKey && key === "x") {
      event.preventDefault();
      insertFormatting("~~", "~~");
      return;
    }

    if (isMod && !event.altKey && !event.shiftKey && key === "k") {
      event.preventDefault();
      insertLink();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();

      const value = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
      const lineBreak = value.indexOf("\n", effectiveEnd);
      const lineEnd = lineBreak === -1 ? value.length : lineBreak;

      if (start !== end && value.slice(start, end).includes("\n")) {
        const block = value.slice(lineStart, lineEnd);
        const lines = block.split("\n");
        let nextLines: string[];
        let removedFromStart = 0;

        if (event.shiftKey) {
          nextLines = lines.map((line, index) => {
            const prefix = /^(?: {1,2}|\t)/.exec(line);
            if (index === 0 && prefix) removedFromStart = prefix[0].length;
            return prefix ? line.slice(prefix[0].length) : line;
          });
        } else {
          nextLines = lines.map((line) => `  ${line}`);
        }

        const replacement = nextLines.join("\n");
        onUpdateContent(value.slice(0, lineStart) + replacement + value.slice(lineEnd));
        window.setTimeout(() => {
          textarea.focus();
          const nextStart = Math.max(lineStart, start + (event.shiftKey ? -removedFromStart : 2));
          const nextEnd = Math.max(nextStart, end + (event.shiftKey ? -removedFromStart : 2 * lines.length));
          textarea.setSelectionRange(nextStart, nextEnd);
        }, 0);
        return;
      }

      if (!event.shiftKey) {
        insertTextAtCursor("  ");
        return;
      }

      const caret = textarea.selectionStart;
      const currentLineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
      const currentLineBreak = value.indexOf("\n", caret);
      const currentLineEnd = currentLineBreak === -1 ? value.length : currentLineBreak;
      const currentLine = value.slice(currentLineStart, currentLineEnd);
      const removable = /^(?: {1,2}|\t)/.exec(currentLine);

      if (removable) {
        const updated = value.slice(0, currentLineStart) + currentLine.slice(removable[0].length) + value.slice(currentLineEnd);
        onUpdateContent(updated);
        window.setTimeout(() => {
          textarea.focus();
          const nextCaret = Math.max(currentLineStart, caret - removable[0].length);
          textarea.setSelectionRange(nextCaret, nextCaret);
        }, 0);
      }
      return;
    }

    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      isMod ||
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      return;
    }

    const value = textarea.value;
    const caret = textarea.selectionStart;
    const lineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const lineBreak = value.indexOf("\n", caret);
    const lineEnd = lineBreak === -1 ? value.length : lineBreak;
    const lineBefore = value.slice(lineStart, caret);
    const lineAfter = value.slice(caret, lineEnd);

    const listMatch = /^(\s*)([-+*]|\d+[.)]|[a-zA-Z]+\)|[ivxlcdm]+\.|（[一二三四五六七八九十百千零〇兩两]+）|\([一二三四五六七八九十百千零〇兩两]+\)|[一二三四五六七八九十百千零〇兩两]+[、.]|[甲乙丙丁戊己庚辛壬癸][、.]|[子丑寅卯辰巳午未申酉戌亥][、.])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(lineBefore);
    if (listMatch) {
      const indent = listMatch[1];
      const marker = listMatch[2];
      const checkboxState = listMatch[3];
      const itemText = listMatch[4];

      // 空白清單項目按 Enter 時退出清單，不再產生新的空項目。
      if (!itemText.trim() && !lineAfter.trim()) {
        event.preventDefault();
        const updated = value.slice(0, lineStart) + indent + value.slice(caret);
        onUpdateContent(updated);
        window.setTimeout(() => {
          textarea.focus();
          const nextCaret = lineStart + indent.length;
          textarea.setSelectionRange(nextCaret, nextCaret);
        }, 0);
        return;
      }

      const nextMarker = nextListMarker(marker);
      const nextPrefix = `${indent}${nextMarker} ${checkboxState !== undefined ? "[ ] " : ""}`;
      event.preventDefault();
      insertTextAtCursor(`\n${nextPrefix}`);
      return;
    }

    const quoteMatch = /^(\s*(?:>\s*)+)(.*)$/.exec(lineBefore);
    if (quoteMatch) {
      const quotePrefix = quoteMatch[1];
      const quoteText = quoteMatch[2];

      // 空白引用行按 Enter 時退出引用。
      if (!quoteText.trim() && !lineAfter.trim()) {
        event.preventDefault();
        const updated = value.slice(0, lineStart) + value.slice(caret);
        onUpdateContent(updated);
        window.setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(lineStart, lineStart);
        }, 0);
        return;
      }

      event.preventDefault();
      insertTextAtCursor(`\n${quotePrefix}`);
    }
  };

  const handleProcessFiles = async (
    files: FileList | File[]
  ) => {
    const list = Array.from(files);

    if (list.length === 0) return;

    setIsUploading(true);
    setUploadMessage(
      `正在儲存 ${list.length} 個附件至本機資料庫…`
    );

    try {
      let insertion = "";

      for (const file of list) {
        const saved = await saveUploadedMedia(file);

        /**
         * 重要：
         * Markdown 內真正保存 media ID，
         * filename 只做顯示名稱。
         */
        const safeLabel = saved.filename
          .replace(/\|/g, "／")
          .replace(/\]/g, "）");

        insertion += `\n![[${saved.id}|${safeLabel}]]\n`;
      }

      insertTextAtCursor(insertion);

      setUploadMessage(
        `已加入 ${list.length} 個附件`
      );

      window.setTimeout(
        () => setUploadMessage(null),
        2600
      );
    } catch (error: any) {
      setUploadMessage(
        `附件儲存失敗：${error?.message || error}`
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removeMediaReference = (
    ref: string
  ) => {
    if (!note) return;

    const escaped = escapeRegExp(ref);

    const regex = new RegExp(
      `!?\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]\\s*`,
      "g"
    );

    onUpdateContent(
      note.content.replace(regex, "")
    );
  };

  const handleDeleteMedia = async (
    ref: string,
    displayName: string
  ) => {
    const confirmed = window.confirm(
      `確定要刪除附件「${displayName}」嗎？\n\n` +
        "此動作會刪除本機 IndexedDB 中的附件，並移除目前筆記中的引用。"
    );

    if (!confirmed) return;

    try {
      await deleteSavedMedia(ref);
      removeMediaReference(ref);

      setUploadMessage(
        `已刪除 ${displayName}`
      );

      window.setTimeout(
        () => setUploadMessage(null),
        2200
      );
    } catch (error: any) {
      setUploadMessage(
        `刪除失敗：${error?.message || error}`
      );
    }
  };

  const handlePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    const files = event.clipboardData?.files;

    if (files?.length) {
      event.preventDefault();
      void handleProcessFiles(files);
    }
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget === event.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setIsDragging(false);

    if (event.dataTransfer?.files?.length) {
      void handleProcessFiles(
        event.dataTransfer.files
      );
    }
  };

  const handlePreviewClick = (
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const target = event.target as HTMLElement;

    const removeButton =
      target.closest<HTMLButtonElement>(
        "[data-media-delete-ref]"
      );

    if (removeButton) {
      event.preventDefault();

      const ref =
        removeButton.dataset.mediaDeleteRef || "";

      const name =
        removeButton.dataset.mediaDeleteName || ref;

      if (ref) {
        void handleDeleteMedia(
          ref,
          name
        );
      }

      return;
    }

    const link =
      target.closest<HTMLAnchorElement>(
        ".obsidian-wikilink"
      );

    if (link) {
      event.preventDefault();

      const noteTitle =
        link.dataset.noteTitle || "";

      const headingSlug =
        link.dataset.headingSlug || "";

      if (
        !noteTitle ||
        note.title.toLowerCase() ===
          noteTitle.toLowerCase()
      ) {
        if (headingSlug) {
          scrollToHeading(headingSlug);
        }
      } else {
        onNavigateToNoteTitle(
          noteTitle,
          headingSlug || undefined
        );
      }

      return;
    }

    const tag =
      target.closest<HTMLElement>(
        ".obsidian-tag"
      );

    if (tag && onSelectTag) {
      event.preventDefault();

      const value = tag.dataset.tag;

      if (value) {
        onSelectTag(value);
      }
    }
  };

  const wordCount = note.content.trim()
    ? note.content.trim().split(/\s+/).length
    : 0;

  const charCount = note.content.length;

  return (
    <div
      className="relative flex h-full min-w-0 flex-col bg-transparent text-slate-100"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {uploadMessage && (
        <div className="fixed bottom-5 right-5 z-[12000] flex items-center gap-2 rounded border border-white/10 bg-[#121415]/95 px-3.5 py-2 text-xs text-slate-200 shadow-2xl">
          <span className="font-serif text-cyan-300">
            {isUploading ? "…" : "✓"}
          </span>
          <span>{uploadMessage}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleProcessFiles(
              event.target.files
            );

            event.target.value = "";
          }
        }}
      />

      <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-5 py-2.5 select-none">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate font-serif text-base font-medium tracking-wide text-slate-100">
            {note.title}
          </h2>

          {note.folder && (
            <span className="hidden max-w-40 truncate text-[10px] text-slate-500 sm:inline">
              {note.folder}
            </span>
          )}

          <span className="hidden text-[10px] text-slate-500 lg:inline">
            {charCount} 字 · {wordCount} 詞
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={isUploading}
            onClick={() =>
              fileInputRef.current?.click()
            }
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
            title="加入圖片、影片或任意檔案"
          >
            檔案 / 媒體
          </button>

          <MediaManagerPanel
            note={note}
            disabled={isUploading}
            onUpdateContent={onUpdateContent}
          />

          <button
            type="button"
            onClick={onOpenGraphView}
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
          >
            圖譜
          </button>

          {/* 外觀設定入口搬到頂部工具列，不再遮擋左側檔案清單。 */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("obsidian-open-appearance-settings"))}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
            title="外觀設定：三區背景與自訂滑鼠游標"
            aria-label="開啟外觀設定"
          >
            <span aria-hidden="true">⚙</span>
            <span className="hidden lg:inline">外觀設定</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onDownloadMarkdown(note)
            }
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
            title="下載此筆記"
          >
            ↓
          </button>

          <div className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2">
            {(["edit", "split", "preview"] as ViewMode[]).map(
              (mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`border-b px-2 py-1 text-xs ${
                    viewMode === mode
                      ? "border-cyan-600 text-slate-100"
                      : "border-transparent text-slate-500 hover:text-slate-200"
                  }`}
                >
                  {mode === "edit"
                    ? "編輯"
                    : mode === "split"
                    ? "雙欄"
                    : "預覽"}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {viewMode !== "preview" && (
        <div className="markdown-editor-toolbar flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-black/10 px-3 py-1 text-xs text-slate-500 select-none">
          <button type="button" title="粗體（Ctrl/⌘+B）" onClick={() => insertFormatting("**", "**")} className="px-2 py-1 font-bold hover:text-slate-200">B</button>
          <button type="button" title="斜體（Ctrl/⌘+I）" onClick={() => insertFormatting("*", "*")} className="px-2 py-1 italic hover:text-slate-200">I</button>
          <button type="button" title="刪除線（Ctrl/⌘+Shift+X）" onClick={() => insertFormatting("~~", "~~")} className="px-2 py-1 line-through hover:text-slate-200">S</button>
          <button type="button" title="螢光標記" onClick={() => insertFormatting("==", "==")} className="px-2 py-1 hover:text-amber-200">標記</button>
          <button type="button" title="行內程式碼" onClick={() => insertFormatting("`", "`")} className="px-2 py-1 font-mono hover:text-slate-200">`code`</button>
          <button type="button" title="程式碼區塊" onClick={() => insertFormatting("```\n", "\n```")} className="px-2 py-1 font-mono hover:text-slate-200">{"</>"}</button>

          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />

          {(["# ", "## ", "### ", "#### ", "##### ", "###### "] as const).map((prefix, index) => (
            <button key={prefix} type="button" title={`標題 H${index + 1}`} onClick={() => applyLinePrefix(prefix)} className="px-1.5 py-1 hover:text-slate-200">H{index + 1}</button>
          ))}

          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />

          <select
            aria-label="清單樣式"
            title="選擇清單樣式（類似 Word）"
            value={listStyleValue}
            onChange={(event) => {
              const value = event.target.value as ListStyle | "";
              if (value) applyListStyle(value);
              setListStyleValue("");
            }}
            className="mx-1 max-w-[132px] shrink-0 cursor-pointer rounded border border-white/10 bg-[#171a19] px-2 py-1 text-slate-300 outline-none hover:border-white/20 hover:text-slate-100 focus:border-cyan-700"
          >
            <option value="" disabled>清單 ▾</option>
            <optgroup label="基本清單">
              <option value="bullet">• 無序清單</option>
              <option value="decimal-dot">1. 2. 3. 數字</option>
              <option value="decimal-paren">1) 2) 3) 數字括號</option>
              <option value="task">☐ 待辦清單</option>
            </optgroup>
            <optgroup label="英文字母與羅馬數字">
              <option value="lower-alpha-paren">a) b) c) 小寫字母</option>
              <option value="upper-alpha-paren">A) B) C) 大寫字母</option>
              <option value="lower-roman">i. ii. iii. 小寫羅馬數字</option>
              <option value="upper-roman">I. II. III. 大寫羅馬數字</option>
            </optgroup>
            <optgroup label="中文序號">
              <option value="cn-ideographic">一、二、三、 中文數字</option>
              <option value="cn-parentheses">（一）（二）（三）</option>
              <option value="cn-heavenly">甲、乙、丙、 天干</option>
              <option value="cn-earthly">子、丑、寅、 地支</option>
            </optgroup>
          </select>
          <button type="button" title="引用區塊" onClick={() => applyLinePrefix("> ")} className="px-2 py-1 hover:text-slate-200">引用</button>
          <button type="button" title="水平分隔線" onClick={() => insertTextAtCursor("\n\n---\n\n")} className="px-2 py-1 hover:text-slate-200">分隔線</button>
          <button type="button" title="插入 Markdown 表格" onClick={() => insertTextAtCursor("\n\n| 欄位 1 | 欄位 2 |\n| --- | --- |\n| 內容 1 | 內容 2 |\n\n")} className="px-2 py-1 hover:text-slate-200">表格</button>
          <button type="button" title="插入超連結（Ctrl/⌘+K）" onClick={insertLink} className="px-2 py-1 hover:text-slate-200">連結</button>

          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />

          <button type="button" onClick={() => insertFormatting("[[", "]]")} title="雙向連結 Wikilink" className="px-2 py-1 text-cyan-300">[[連結]]</button>
          <button type="button" onClick={() => insertFormatting("#")} title="插入標籤" className="px-2 py-1 hover:text-slate-200">#標籤</button>
          <button type="button" onClick={() => fileInputRef.current?.click()} title="上傳並嵌入圖片、影片或檔案" className="px-2 py-1 text-cyan-300">![[媒體]]</button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {(viewMode === "edit" ||
          viewMode === "split") && (
          <div
            className={`min-w-0 ${
              viewMode === "split"
                ? "w-1/2 border-r border-slate-800"
                : "w-full"
            }`}
          >
            <textarea
              ref={textareaRef}
              value={note.content}
              onChange={(event) =>
                onUpdateContent(
                  event.target.value
                )
              }
              onKeyDown={handleEditorKeyDown}
              onPaste={handlePaste}
              spellCheck={false}
              className="h-full w-full resize-none bg-transparent p-5 font-mono text-sm leading-7 text-slate-200 outline-none"
            />
          </div>
        )}

        {(viewMode === "preview" ||
          viewMode === "split") && (
          <div
            className={`paper-texture min-w-0 overflow-y-auto ${
              viewMode === "split"
                ? "w-1/2"
                : "w-full"
            }`}
          >
            <div
              ref={previewRef}
              className="obsidian-preview-container"
              onClick={handlePreviewClick}
              dangerouslySetInnerHTML={{
                __html: sanitizedHtml,
              }}
            />
          </div>
        )}

        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center border border-dashed border-cyan-500/50 bg-black/60">
            <div className="text-center">
              <div className="font-serif text-lg text-slate-200">
                放下附件
              </div>
              <div className="mt-1 text-xs text-slate-500">
                將儲存至本機 IndexedDB
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
