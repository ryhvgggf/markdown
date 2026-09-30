"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { renderMarkdownToHtml } from "@/lib/obsidian/parser";
import { Note, ViewMode } from "@/lib/obsidian/types";
import { saveUploadedMedia, resolveMediaUrl, revokeAllActiveMediaUrls } from "@/lib/obsidian/media";

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
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // 切換筆記或組件卸載時，釋放先前的 Object URLs
  useEffect(() => {
    return () => {
      revokeAllActiveMediaUrls();
    };
  }, [note?.id]);

  // 靜態渲染 HTML
  const renderedHtml = useMemo(() => {
    if (!note) return "";
    return renderMarkdownToHtml(note.content, existingTitles, note.title);
  }, [note?.content, existingTitles, note?.title]);

  // 平滑滾動定位至指定標題並發光高亮
  const scrollToHeading = useCallback((slug: string) => {
    if (!previewRef.current) return;
    let targetEl: HTMLElement | null = null;
    try {
      const elById = document.getElementById(slug);
      if (elById && previewRef.current.contains(elById)) {
        targetEl = elById;
      }
      if (!targetEl) {
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(slug) : slug.replace(/[^a-zA-Z0-9_-]/g, '\\const targetEl = previewRef.current.querySelector<HTMLElement>(`#${slug}`);');
        targetEl = previewRef.current.querySelector<HTMLElement>('[id="' + escaped + '"]') ||
                   previewRef.current.querySelector<HTMLElement>('[data-heading-slug="' + escaped + '"]');
      }
    } catch (e) {
      console.warn("無法定位標題錨點:", e);
    }
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      targetEl.classList.add("bg-purple-900/60", "ring-2", "ring-purple-400", "shadow-xl");
      setTimeout(() => {
        targetEl.classList.remove("bg-purple-900/60", "ring-2", "ring-purple-400", "shadow-xl");
      }, 2200);
    }
  }, []);

  // 當外部傳入目標章節標題 slug 時自動滾動定位
  useEffect(() => {
    if (!targetHeadingSlug || !note) return;
    const timer = setTimeout(() => {
      scrollToHeading(targetHeadingSlug);
      if (onClearTargetHeadingSlug) {
        onClearTargetHeadingSlug();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [targetHeadingSlug, note?.id, scrollToHeading, onClearTargetHeadingSlug]);

  // 動態非同步注入 IndexedDB 中的多媒體 Object URLs 到預覽畫面
  useEffect(() => {
    if (!previewRef.current || !note) return;

    let isCancelled = false;
    const container = previewRef.current;
    const mediaNodes = container.querySelectorAll<HTMLElement>(".obsidian-media-container[data-media-name]");

    mediaNodes.forEach(async (el) => {
      const mediaName = el.getAttribute("data-media-name");
      const isVid = el.getAttribute("data-is-video") === "true";
      if (!mediaName) return;

      try {
        const objectUrl = await resolveMediaUrl(mediaName);
        if (isCancelled || !el.parentElement) return;

        if (objectUrl) {
          if (isVid) {
            el.innerHTML = `<div class="relative group/media inline-block my-2 max-w-full"><video controls class="rounded-2xl max-h-96 max-w-full border border-slate-800 shadow-md" src="${objectUrl}">無法播放此影片格式</video><a href="${objectUrl}" download="${mediaName}" title="下載原始影片 (${mediaName})" class="opacity-0 group-hover/media:opacity-100 absolute top-3 right-3 bg-slate-900/85 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-slate-700/80 backdrop-blur-md transition flex items-center gap-1 cursor-pointer select-none"><span>⬇️</span><span>下載原檔</span></a></div>`;
          } else {
            el.innerHTML = `<div class="relative group/media inline-block my-2 max-w-full"><img src="${objectUrl}" alt="${mediaName}" class="rounded-2xl max-h-96 max-w-full object-contain border border-slate-800 shadow-md hover:opacity-95 transition" /><a href="${objectUrl}" download="${mediaName}" title="下載原始圖片 (${mediaName})" class="opacity-0 group-hover/media:opacity-100 absolute top-3 right-3 bg-slate-900/85 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded-xl shadow-lg border border-slate-700/80 backdrop-blur-md transition flex items-center gap-1 cursor-pointer select-none"><span>⬇️</span><span>下載原檔</span></a></div>`;
          }
        } else {
          el.innerHTML = `<span class="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/60 px-2.5 py-1 rounded-full inline-flex items-center gap-1 font-mono">⚠️ 附件「${mediaName}」不存在於本機庫</span>`;
        }
      } catch (err) {
        if (!isCancelled && el.parentElement) {
          el.innerHTML = `<span class="text-xs text-red-400 font-mono">載入失敗: ${mediaName}</span>`;
        }
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [renderedHtml, note?.id]);

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-400">
        <div className="mb-4 rounded-3xl bg-purple-950/40 p-4 border border-purple-800/40 shadow-xl">
          <svg className="w-12 h-12 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-slate-200">未選取任何筆記</h3>
        <p className="mt-1 text-xs text-slate-500">請從左側列表或資料夾中選取筆記，或點選「新筆記」開始建立知識庫！</p>
      </div>
    );
  }

  // 格式插入輔助函數
  const insertFormatting = (prefix: string, suffix: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const replacement = `${prefix}${selected || "文字"}${suffix}`;

    const newContent = text.substring(0, start) + replacement + text.substring(end);
    onUpdateContent(newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selected.length || "文字".length)
      );
    }, 0);
  };

  const insertTextAtCursor = (insertion: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onUpdateContent(note.content + "\n" + insertion);
      return;
    }

    const start = textarea.selectionStart;
    const text = textarea.value;
    const newContent = text.substring(0, start) + insertion + text.substring(start);
    onUpdateContent(newContent);

    setTimeout(() => {
      textarea.focus();
      const nextPos = start + insertion.length;
      textarea.setSelectionRange(nextPos, nextPos);
    }, 0);
  };

  // 處理檔案上傳
  const handleProcessFiles = async (files: FileList | File[]) => {
    const mediaFiles = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );

    if (mediaFiles.length === 0) return;

    setIsUploading(true);
    setUploadMessage(`正在儲存 ${mediaFiles.length} 個檔案到 IndexedDB...`);

    try {
      let insertTags = "";
      for (const file of mediaFiles) {
        const saved = await saveUploadedMedia(file);
        insertTags += `\n![[${saved.id}|${saved.filename}]]\n`;
    }
      insertTextAtCursor(insertTags);
      setUploadMessage(`已成功儲存並插入 ${mediaFiles.length} 個多媒體檔案！`);
      setTimeout(() => setUploadMessage(null), 3000);
    } catch (err: any) {
      alert(`儲存多媒體失敗: ${err.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      const hasMedia = Array.from(e.clipboardData.files).some(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
      );
      if (hasMedia) {
        e.preventDefault();
        handleProcessFiles(e.clipboardData.files);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFiles(e.dataTransfer.files);
    }
  };

  // 點擊預覽區內的 Wikilink、章節標題跳轉與標籤
  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // 點選雙向鏈結 (支援 [[Note#Heading]])
    const linkEl = target.closest<HTMLAnchorElement>(".obsidian-wikilink");
    if (linkEl) {
      e.preventDefault();
      const noteTitle = linkEl.getAttribute("data-note-title");
      const headingSlug = linkEl.getAttribute("data-heading-slug");

      // 如果是指向當前筆記內部標題（或無 noteTitle）
      if (!noteTitle || (note && note.title.toLowerCase() === noteTitle.toLowerCase())) {
        if (headingSlug) {
          scrollToHeading(headingSlug);
        }
      } else {
        // 跨筆記標題跳轉
        onNavigateToNoteTitle(noteTitle, headingSlug || undefined);
      }
      return;
    }

    // 點選標籤
    const tagEl = target.closest<HTMLElement>(".obsidian-tag");
    if (tagEl && onSelectTag) {
      e.preventDefault();
      const tag = tagEl.getAttribute("data-tag");
      if (tag) {
        onSelectTag(tag);
      }
      return;
    }
  };

  const wordCount = note.content.trim() ? note.content.trim().split(/\s+/).length : 0;
  const charCount = note.content.length;

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100 min-w-0 relative">
      {uploadMessage && (
        <div className="absolute top-3 right-5 z-50 rounded-full bg-purple-600 px-4 py-1.5 text-xs text-white shadow-xl flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
          </svg>
          {uploadMessage}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleProcessFiles(e.target.files);
            e.target.value = "";
          }
        }}
        multiple
        accept="image/*,video/*"
        className="hidden"
      />

      {/* 頂部操作欄 */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-bold text-slate-100 truncate tracking-tight flex items-center gap-2">
            <span>{note.title}</span>
            {note.folder && (
              <span className="text-[11px] font-normal text-purple-400 bg-purple-950/50 border border-purple-800/50 px-2.5 py-0.5 rounded-full font-mono">
                📁 {note.folder}
              </span>
            )}
          </h2>
          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            {charCount} 字元 · {wordCount} 詞
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="rounded-full bg-slate-800/80 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition cursor-pointer border border-slate-700/80 shadow-sm flex items-center gap-1.5"
            title="上傳圖片或影片 (亦支援直接拖曳或剪貼簿貼上)"
          >
            <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            插入媒體
          </button>

          <button
            onClick={onOpenGraphView}
            className="rounded-full bg-purple-950/40 hover:bg-purple-900/50 px-3 py-1 text-xs font-medium text-purple-300 transition cursor-pointer border border-purple-800/50 shadow-sm flex items-center gap-1.5"
            title="開啟關聯圖譜"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
            關聯圖譜
          </button>

          <button
            onClick={() => onDownloadMarkdown(note)}
            className="p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700/80 shadow-sm"
            title="下載單篇 Markdown 檔案"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          {/* 模式切換器 */}
          <div className="flex rounded-full bg-slate-900/90 p-0.5 border border-slate-700/80 shadow-inner">
            <button
              onClick={() => setViewMode("edit")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                viewMode === "edit"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              編輯
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer hidden md:inline-block ${
                viewMode === "split"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              雙欄
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                viewMode === "preview"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              預覽
            </button>
          </div>
        </div>
      </div>

      {/* 快速排版工具列 */}
      {viewMode !== "preview" && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-800 bg-slate-900/40 px-4 py-1.5 text-slate-400 text-xs">
          <button
            onClick={() => insertFormatting("**", "**")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="粗體"
          >
            B
          </button>
          <button
            onClick={() => insertFormatting("*", "*")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 italic font-serif"
            title="斜體"
          >
            I
          </button>
          <button
            onClick={() => insertFormatting("## ")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="二級標題"
          >
            H2
          </button>
          <button
            onClick={() => insertFormatting("### ")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="三級標題"
          >
            H3
          </button>
          <button
            onClick={() => insertFormatting("- [ ] ")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200"
            title="待辦清單"
          >
            ☑
          </button>
          <button
            onClick={() => insertFormatting("- ")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200"
            title="無序清單"
          >
            • 清單
          </button>
          <button
            onClick={() => insertFormatting("> ")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200"
            title="引用區塊"
          >
            “ 引用
          </button>
          <button
            onClick={() => insertFormatting("[[", "]]")}
            className="rounded-full px-2.5 py-0.5 bg-purple-900/50 text-purple-300 hover:bg-purple-800 hover:text-purple-100 font-mono font-bold"
            title="雙向連結 Wikilink (亦支援 [[筆記#章節]])"
          >
            [[連結]]
          </button>
          <button
            onClick={() => insertFormatting("#")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 hover:text-slate-200 font-bold"
            title="標籤"
          >
            #標籤
          </button>
          <button
            onClick={() => insertFormatting("![[", "]]")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 text-purple-300 hover:text-purple-200 font-mono"
            title="嵌入多媒體 ![[檔名]]"
          >
            ![[媒體]]
          </button>
        </div>
      )}

      {/* 主要工作區 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 overflow-hidden flex min-h-0 relative ${
          isDragging ? "ring-2 ring-purple-500 bg-purple-950/20" : ""
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs border-2 border-dashed border-purple-500 rounded-3xl pointer-events-none">
            <div className="text-center">
              <svg className="w-12 h-12 text-purple-400 mx-auto mb-2 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-bold text-purple-200">放開滑鼠以儲存圖片或影片至本機庫</p>
            </div>
          </div>
        )}

        {/* 編輯區 */}
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className={`flex flex-col h-full ${
              viewMode === "split" ? "w-1/2 border-r border-slate-800" : "w-full"
            }`}
          >
            <textarea
              ref={textareaRef}
              value={note.content}
              onChange={(e) => onUpdateContent(e.target.value)}
              onPaste={handlePaste}
              placeholder="在此開始撰寫 Markdown 內容，支援 [[筆記]] 與 [[筆記#章節]] 雙向連結、#標籤、或直接貼上/拖入圖片與影片..."
              className="flex-1 w-full resize-none bg-transparent p-5 font-mono text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
          </div>
        )}

        {/* 預覽區 */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div
            ref={previewRef}
            onClick={handlePreviewClick}
            className={`flex flex-col h-full overflow-y-auto p-6 bg-slate-900/30 ${
              viewMode === "split" ? "w-1/2" : "w-full"
            }`}
          >
            <div
              className="obsidian-preview-container max-w-none text-slate-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
