"use client";

import DOMPurify from "dompurify";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

    const deleteButton =
      target.closest<HTMLButtonElement>(
        "[data-media-delete-ref]"
      );

    if (deleteButton) {
      event.preventDefault();

      const ref =
        deleteButton.dataset.mediaDeleteRef || "";

      const name =
        deleteButton.dataset.mediaDeleteName || ref;

      if (ref) {
        void handleDeleteMedia(ref, name);
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

          <button
            type="button"
            onClick={onOpenGraphView}
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
          >
            圖譜
          </button>

          <button
            type="button"
            onClick={() =>
              onDownloadMarkdown(note)
            }
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100"
            title="下載 Markdown"
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
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-black/10 px-4 py-1 text-xs text-slate-500 select-none">
          <button
            type="button"
            onClick={() =>
              insertFormatting("**", "**")
            }
            className="px-2 py-1 font-bold hover:text-slate-200"
          >
            B
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("*", "*")
            }
            className="px-2 py-1 italic hover:text-slate-200"
          >
            I
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("## ")
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            H2
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("### ")
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            H3
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("- ")
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            • 清單
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("> ")
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            引用
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("[[", "]]")
            }
            title="雙向連結 Wikilink"
            className="px-2 py-1 text-cyan-300"
          >
            [[連結]]
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting("#")
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            #標籤
          </button>

          <button
            type="button"
            onClick={() =>
              fileInputRef.current?.click()
            }
            title="嵌入多媒體"
            className="px-2 py-1 text-cyan-300"
          >
            ![[媒體]]
          </button>
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
