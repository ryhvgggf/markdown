"use client";

import DOMPurify from "dompurify";

import {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";

import { renderMarkdownToHtml } from "@/lib/obsidian/parser";

import {
  Note,
  ViewMode,
} from "@/lib/obsidian/types";

import {
  saveUploadedMedia,
  resolveMediaUrl,
  revokeAllActiveMediaUrls,
  deleteSavedMedia,
} from "@/lib/obsidian/media";

/**
 * 防止動態文字直接插入 innerHTML。
 */
function escapeHtml(
  value: string
): string {
  return value
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

interface MarkdownEditorProps {
  note: Note | null;
  existingTitles: string[];
  targetHeadingSlug?: string | null;
  onClearTargetHeadingSlug?: () => void;
  onUpdateContent: (
    content: string
  ) => void;
  onNavigateToNoteTitle: (
    title: string,
    headingSlug?: string
  ) => void;
  onDownloadMarkdown: (
    note: Note
  ) => void;
  onOpenGraphView: () => void;
  onSelectTag?: (
    tag: string
  ) => void;
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
  const [
    viewMode,
    setViewMode,
  ] = useState<ViewMode>(
    "split"
  );

  const [
    isUploading,
    setIsUploading,
  ] = useState(false);

  const [
    uploadMessage,
    setUploadMessage,
  ] = useState<
    string | null
  >(null);

  const [
    isDragging,
    setIsDragging,
  ] = useState(false);

  const [
    renderedHtml,
    setRenderedHtml,
  ] = useState("");

  const textareaRef =
    useRef<HTMLTextAreaElement>(
      null
    );

  const fileInputRef =
    useRef<HTMLInputElement>(
      null
    );

  const previewRef =
    useRef<HTMLDivElement>(
      null
    );

  /**
   * Component 卸載時釋放所有 Blob URL。
   */
  useEffect(() => {
    return () => {
      revokeAllActiveMediaUrls();
    };
  }, []);

  /**
   * Markdown → HTML。
   */
  const rawHtml = useMemo(() => {
    if (!note) {
      return "";
    }

    return renderMarkdownToHtml(
      note.content,
      existingTitles,
      note.title
    );
  }, [
    note?.content,
    note?.title,
    existingTitles,
  ]);

  /**
   * XSS 防護。
   */
  useEffect(() => {
    if (!rawHtml) {
      setRenderedHtml("");
      return;
    }

    const safeHtml =
      DOMPurify.sanitize(
        rawHtml
      );

    setRenderedHtml(
      safeHtml
    );
  }, [rawHtml]);

  /**
   * 平滑移動到 Markdown Heading。
   */
  const scrollToHeading =
    useCallback(
      (slug: string) => {
        if (
          !previewRef.current
        ) {
          return;
        }

        let targetEl:
          | HTMLElement
          | null = null;

        try {
          const elById =
            document.getElementById(
              slug
            );

          if (
            elById &&
            previewRef.current.contains(
              elById
            )
          ) {
            targetEl = elById;
          }

          if (!targetEl) {
            const escaped =
              typeof CSS !==
                "undefined" &&
              CSS.escape
                ? CSS.escape(
                    slug
                  )
                : slug.replace(
                    /[^a-zA-Z0-9_-]/g,
                    "\\$&"
                  );

            targetEl =
              previewRef.current.querySelector<HTMLElement>(
                `[id="${escaped}"]`
              ) ||
              previewRef.current.querySelector<HTMLElement>(
                `[data-heading-slug="${escaped}"]`
              );
          }
        } catch (error) {
          console.warn(
            "無法定位標題錨點:",
            error
          );
        }

        if (targetEl) {
          targetEl.scrollIntoView(
            {
              behavior:
                "smooth",
              block: "start",
            }
          );

          targetEl.classList.add(
            "bg-purple-900/60",
            "ring-2",
            "ring-purple-400",
            "shadow-xl"
          );

          setTimeout(() => {
            targetEl?.classList.remove(
              "bg-purple-900/60",
              "ring-2",
              "ring-purple-400",
              "shadow-xl"
            );
          }, 2200);
        }
      },
      []
    );

  /**
   * 外部指定 Heading 時自動定位。
   */
  useEffect(() => {
    if (
      !targetHeadingSlug ||
      !note
    ) {
      return;
    }

    const timer =
      setTimeout(() => {
        scrollToHeading(
          targetHeadingSlug
        );

        onClearTargetHeadingSlug?.();
      }, 200);

    return () =>
      clearTimeout(timer);
  }, [
    targetHeadingSlug,
    note?.id,
    scrollToHeading,
    onClearTargetHeadingSlug,
  ]);

  /**
   * 將 IndexedDB 媒體轉成 Blob URL。
   */
  useEffect(() => {
    if (
      !previewRef.current ||
      !note
    ) {
      return;
    }

    let isCancelled =
      false;

    const container =
      previewRef.current;

    const mediaNodes =
      container.querySelectorAll<HTMLElement>(
        ".obsidian-media-container[data-media-name]"
      );

    mediaNodes.forEach(
      async (el) => {
        const mediaName =
          el.getAttribute(
            "data-media-name"
          );

        const isVid =
          el.getAttribute(
            "data-is-video"
          ) === "true";

        if (!mediaName) {
          return;
        }

        const safeMediaName =
          escapeHtml(
            mediaName
          );

        try {
          const objectUrl =
            await resolveMediaUrl(
              mediaName
            );

          if (
            isCancelled ||
            !el.parentElement
          ) {
            return;
          }

          if (objectUrl) {
            const safeObjectUrl =
              escapeHtml(
                objectUrl
              );

            if (isVid) {
              el.innerHTML = `
                <div
                  class="relative group/media inline-block my-2 max-w-full"
                >
                  <video
                    controls
                    class="rounded-2xl max-h-96 max-w-full border border-slate-800 shadow-md"
                    src="${safeObjectUrl}"
                  >
                    無法播放此影片格式
                  </video>

                  <div
                    class="opacity-0 group-hover/media:opacity-100 absolute top-3 right-3 flex items-center gap-1.5 transition"
                  >
                    <a
                      href="${safeObjectUrl}"
                      download="${safeMediaName}"
                      title="下載原始影片"
                      class="bg-slate-900/90 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-slate-700/80 backdrop-blur-md flex items-center gap-1 cursor-pointer select-none"
                    >
                      <span>⬇️</span>
                      <span>下載</span>
                    </a>

                    <button
                      type="button"
                      data-delete-media-id="${safeMediaName}"
                      data-delete-media-name="${safeMediaName}"
                      title="刪除影片"
                      class="bg-red-950/90 hover:bg-red-600 text-red-200 hover:text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-red-800/80 backdrop-blur-md flex items-center gap-1 cursor-pointer select-none"
                    >
                      <span>🗑</span>
                      <span>刪除</span>
                    </button>
                  </div>
                </div>
              `;
            } else {
              el.innerHTML = `
                <div
                  class="relative group/media inline-block my-2 max-w-full"
                >
                  <img
                    src="${safeObjectUrl}"
                    alt="${safeMediaName}"
                    class="rounded-2xl max-h-96 max-w-full object-contain border border-slate-800 shadow-md hover:opacity-95 transition"
                  />

                  <div
                    class="opacity-0 group-hover/media:opacity-100 absolute top-3 right-3 flex items-center gap-1.5 transition"
                  >
                    <a
                      href="${safeObjectUrl}"
                      download="${safeMediaName}"
                      title="下載原始圖片"
                      class="bg-slate-900/90 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-slate-700/80 backdrop-blur-md flex items-center gap-1 cursor-pointer select-none"
                    >
                      <span>⬇️</span>
                      <span>下載</span>
                    </a>

                    <button
                      type="button"
                      data-delete-media-id="${safeMediaName}"
                      data-delete-media-name="${safeMediaName}"
                      title="刪除圖片"
                      class="bg-red-950/90 hover:bg-red-600 text-red-200 hover:text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-red-800/80 backdrop-blur-md flex items-center gap-1 cursor-pointer select-none"
                    >
                      <span>🗑</span>
                      <span>刪除</span>
                    </button>
                  </div>
                </div>
              `;
            }
          } else {
            el.innerHTML = `
              <div class="inline-flex items-center gap-2">
                <span
                  class="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/60 px-2.5 py-1 rounded-full font-mono"
                >
                  ⚠️ 附件「${safeMediaName}」不存在於本機庫
                </span>

                <button
                  type="button"
                  data-delete-media-id="${safeMediaName}"
                  data-delete-media-name="${safeMediaName}"
                  class="text-xs text-red-300 hover:text-white bg-red-950/60 hover:bg-red-700 border border-red-800/60 px-2.5 py-1 rounded-full"
                >
                  移除引用
                </button>
              </div>
            `;
          }
        } catch (error) {
          console.error(
            "載入媒體失敗:",
            error
          );

          if (
            !isCancelled &&
            el.parentElement
          ) {
            el.innerHTML = `
              <div class="inline-flex items-center gap-2">
                <span
                  class="text-xs text-red-400 font-mono"
                >
                  載入失敗: ${safeMediaName}
                </span>

                <button
                  type="button"
                  data-delete-media-id="${safeMediaName}"
                  data-delete-media-name="${safeMediaName}"
                  class="text-xs text-red-300 hover:text-white bg-red-950/60 hover:bg-red-700 border border-red-800/60 px-2.5 py-1 rounded-full"
                >
                  移除引用
                </button>
              </div>
            `;
          }
        }
      }
    );

    return () => {
      isCancelled = true;
    };
  }, [
    renderedHtml,
    note?.id,
  ]);

  /**
   * Markdown 格式插入。
   */
  const insertFormatting = (
    prefix: string,
    suffix: string = ""
  ) => {
    const textarea =
      textareaRef.current;

    if (!textarea) {
      return;
    }

    const start =
      textarea.selectionStart;

    const end =
      textarea.selectionEnd;

    const text =
      textarea.value;

    const selected =
      text.substring(
        start,
        end
      );

    const replacement =
      `${prefix}${
        selected || "文字"
      }${suffix}`;

    const newContent =
      text.substring(
        0,
        start
      ) +
      replacement +
      text.substring(end);

    onUpdateContent(
      newContent
    );

    setTimeout(() => {
      textarea.focus();

      textarea.setSelectionRange(
        start +
          prefix.length,
        start +
          prefix.length +
          (
            selected.length ||
            "文字".length
          )
      );
    }, 0);
  };

  /**
   * 在游標位置插入文字。
   */
  const insertTextAtCursor = (
    insertion: string
  ) => {
    const textarea =
      textareaRef.current;

    if (!textarea) {
      onUpdateContent(
        note.content +
          "\n" +
          insertion
      );

      return;
    }

    const start =
      textarea.selectionStart;

    const text =
      textarea.value;

    const newContent =
      text.substring(
        0,
        start
      ) +
      insertion +
      text.substring(start);

    onUpdateContent(
      newContent
    );

    setTimeout(() => {
      textarea.focus();

      const nextPos =
        start +
        insertion.length;

      textarea.setSelectionRange(
        nextPos,
        nextPos
      );
    }, 0);
  };

  /**
   * 圖片 / 影片處理。
   */
  const handleProcessFiles =
    async (
      files:
        | FileList
        | File[]
    ) => {
      const mediaFiles =
        Array.from(
          files
        ).filter(
          (file) =>
            file.type.startsWith(
              "image/"
            ) ||
            file.type.startsWith(
              "video/"
            )
        );

      if (
        mediaFiles.length === 0
      ) {
        return;
      }

      setIsUploading(true);

      setUploadMessage(
        `正在儲存 ${mediaFiles.length} 個檔案到 IndexedDB...`
      );

      try {
        let insertTags = "";

        for (
          const file of mediaFiles
        ) {
          const saved =
            await saveUploadedMedia(
              file
            );

          insertTags +=
            `\n![[${saved.id}|${saved.filename}]]\n`;
        }

        insertTextAtCursor(
          insertTags
        );

        setUploadMessage(
          `已成功儲存並插入 ${mediaFiles.length} 個多媒體檔案！`
        );

        setTimeout(() => {
          setUploadMessage(
            null
          );
        }, 3000);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        alert(
          `儲存多媒體失敗: ${message}`
        );
      } finally {
        setIsUploading(false);
      }
    };

  /**
   * 剪貼簿貼上圖片 / 影片。
   */
  const handlePaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    if (
      e.clipboardData &&
      e.clipboardData.files &&
      e.clipboardData.files.length >
        0
    ) {
      const hasMedia =
        Array.from(
          e.clipboardData.files
        ).some(
          (file) =>
            file.type.startsWith(
              "image/"
            ) ||
            file.type.startsWith(
              "video/"
            )
        );

      if (hasMedia) {
        e.preventDefault();

        void handleProcessFiles(
          e.clipboardData.files
        );
      }
    }
  };

  /**
   * Drag Over。
   */
  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
  };

  /**
   * Drag Leave。
   */
  const handleDragLeave = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
  };

  /**
   * Drop。
   */
  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);

    if (
      e.dataTransfer &&
      e.dataTransfer.files &&
      e.dataTransfer.files.length >
        0
    ) {
      void handleProcessFiles(
        e.dataTransfer.files
      );
    }
  };

  /**
   * 移除 Markdown 中指定 media ID 的所有引用。
   *
   * 支援：
   *
   * ![[media-123]]
   * ![[media-123|image.png]]
   */
  const removeMediaReferences =
    useCallback(
      (mediaId: string) => {
        if (!note) {
          return;
        }

        const escapedId =
          mediaId.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

        const pattern =
          new RegExp(
            `!\\[\\[${escapedId}(?:\\|[^\\]]*)?\\]\\]\\n?`,
            "g"
          );

        const nextContent =
          note.content.replace(
            pattern,
            ""
          );

        if (
          nextContent !==
          note.content
        ) {
          onUpdateContent(
            nextContent
          );
        }
      },
      [
        note,
        onUpdateContent,
      ]
    );

  /**
   * 刪除已儲存的圖片 / 影片。
   */
  const handleDeleteMedia =
    useCallback(
      async (
        mediaId: string,
        mediaName: string
      ) => {
        if (!mediaId) {
          return;
        }

        const confirmed =
          window.confirm(
            `確定要刪除「${mediaName}」嗎？\n\n` +
              `這會從本機 IndexedDB 永久刪除檔案，` +
              `並移除目前筆記中的所有媒體引用。`
          );

        if (!confirmed) {
          return;
        }

        try {
          /**
           * 先刪 IndexedDB，
           * 同時 revoke Object URL。
           */
          await deleteSavedMedia(
            mediaId
          );

          /**
           * 再刪 Markdown 引用。
           */
          removeMediaReferences(
            mediaId
          );

          setUploadMessage(
            `已刪除媒體：${mediaName}`
          );

          setTimeout(() => {
            setUploadMessage(
              null
            );
          }, 2500);
        } catch (error: unknown) {
          console.error(
            "刪除媒體失敗:",
            error
          );

          const message =
            error instanceof Error
              ? error.message
              : String(error);

          alert(
            `刪除媒體失敗：${message}`
          );
        }
      },
      [
        removeMediaReferences,
      ]
    );

  /**
   * 預覽區點擊事件。
   */
  const handlePreviewClick = (
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    const target =
      e.target as HTMLElement;

    /**
     * =========================
     * 刪除 Media
     * =========================
     */
    const deleteButton =
      target.closest<HTMLButtonElement>(
        "[data-delete-media-id]"
      );

    if (deleteButton) {
      e.preventDefault();
      e.stopPropagation();

      const mediaId =
        deleteButton.getAttribute(
          "data-delete-media-id"
        );

      const mediaName =
        deleteButton.getAttribute(
          "data-delete-media-name"
        ) ||
        mediaId ||
        "未知檔案";

      if (mediaId) {
        void handleDeleteMedia(
          mediaId,
          mediaName
        );
      }

      return;
    }

    /**
     * =========================
     * Wikilink
     * =========================
     */
    const linkEl =
      target.closest<HTMLAnchorElement>(
        ".obsidian-wikilink"
      );

    if (linkEl) {
      e.preventDefault();

      const noteTitle =
        linkEl.getAttribute(
          "data-note-title"
        );

      const headingSlug =
        linkEl.getAttribute(
          "data-heading-slug"
        );

      if (
        !noteTitle ||
        note.title.toLowerCase() ===
          noteTitle.toLowerCase()
      ) {
        if (headingSlug) {
          scrollToHeading(
            headingSlug
          );
        }
      } else {
        onNavigateToNoteTitle(
          noteTitle,
          headingSlug ||
            undefined
        );
      }

      return;
    }

    /**
     * =========================
     * Tag
     * =========================
     */
    const tagEl =
      target.closest<HTMLElement>(
        ".obsidian-tag"
      );

    if (
      tagEl &&
      onSelectTag
    ) {
      e.preventDefault();

      const tag =
        tagEl.getAttribute(
          "data-tag"
        );

      if (tag) {
        onSelectTag(tag);
      }

      return;
    }
  };

  /**
   * 沒有選擇筆記。
   */
  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-400">
        <div className="mb-4 rounded-3xl bg-purple-950/40 p-4 border border-purple-800/40 shadow-xl">
          <svg
            className="w-12 h-12 text-purple-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
          </svg>
        </div>

        <h3 className="text-lg font-bold text-slate-200">
          未選取任何筆記
        </h3>

        <p className="mt-1 text-xs text-slate-500">
          請從左側列表或資料夾中選取筆記，
          或點選「新筆記」開始建立知識庫！
        </p>
      </div>
    );
  }

  const wordCount =
    note.content.trim()
      ? note.content
          .trim()
          .split(/\s+/)
          .length
      : 0;

  const charCount =
    note.content.length;

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100 min-w-0 relative">
      {/* 上傳 / 操作狀態 */}
      {uploadMessage && (
        <div className="absolute top-3 right-5 z-50 rounded-full bg-purple-600 px-4 py-1.5 text-xs text-white shadow-xl flex items-center gap-2 animate-bounce">
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              strokeWidth="3"
              strokeDasharray="32"
              strokeLinecap="round"
            />
          </svg>

          {uploadMessage}
        </div>
      )}

      {/* 隱藏檔案選擇器 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (
            e.target.files &&
            e.target.files.length >
              0
          ) {
            void handleProcessFiles(
              e.target.files
            );

            e.target.value = "";
          }
        }}
        multiple
        accept="image/*,video/*"
        className="hidden"
      />

      {/* 頂部操作列 */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-bold text-slate-100 truncate tracking-tight flex items-center gap-2">
            <span>
              {note.title}
            </span>

            {note.folder && (
              <span className="text-[11px] font-normal text-purple-400 bg-purple-950/50 border border-purple-800/50 px-2.5 py-0.5 rounded-full font-mono">
                📁 {note.folder}
              </span>
            )}
          </h2>

          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            {charCount} 字元 ·{" "}
            {wordCount} 詞
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 插入媒體 */}
          <button
            type="button"
            onClick={() =>
              fileInputRef.current?.click()
            }
            disabled={isUploading}
            className="rounded-full bg-slate-800/80 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition cursor-pointer border border-slate-700/80 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="上傳圖片或影片"
          >
            <svg
              className="w-3.5 h-3.5 text-purple-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>

            插入媒體
          </button>

          {/* 關聯圖譜 */}
          <button
            type="button"
            onClick={
              onOpenGraphView
            }
            className="rounded-full bg-purple-950/40 hover:bg-purple-900/50 px-3 py-1 text-xs font-medium text-purple-300 transition cursor-pointer border border-purple-800/50 shadow-sm flex items-center gap-1.5"
            title="開啟關聯圖譜"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>

            關聯圖譜
          </button>

          {/* Markdown 下載 */}
          <button
            type="button"
            onClick={() =>
              onDownloadMarkdown(
                note
              )
            }
            className="p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700/80 shadow-sm"
            title="下載單篇 Markdown"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>

          {/* 檢視模式 */}
          <div className="flex rounded-full bg-slate-900/90 p-0.5 border border-slate-700/80 shadow-inner">
            <button
              type="button"
              onClick={() =>
                setViewMode(
                  "edit"
                )
              }
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                viewMode ===
                "edit"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              編輯
            </button>

            <button
              type="button"
              onClick={() =>
                setViewMode(
                  "split"
                )
              }
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer hidden md:inline-block ${
                viewMode ===
                "split"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              雙欄
            </button>

            <button
              type="button"
              onClick={() =>
                setViewMode(
                  "preview"
                )
              }
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                viewMode ===
                "preview"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              預覽
            </button>
          </div>
        </div>
      </div>

      {/* Markdown 工具列 */}
      {viewMode !==
        "preview" && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-800 bg-slate-900/40 px-4 py-1.5 text-slate-400 text-xs">
          <button
            type="button"
            onClick={() =>
              insertFormatting(
                "**",
                "**"
              )
            }
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="粗體"
          >
            B
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting(
                "*",
                "*"
              )
            }
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 italic font-serif"
            title="斜體"
          >
            I
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting(
                "## "
              )
            }
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="二級標題"
          >
            H2
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting(
                "### "
              )
            }
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="三級標題"
          >
            H3
          </button>

          <button
            type="button"
            onClick={() =>
              insertFormatting(
                "- [ ] "
              )
            }
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200"
            title="
