"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { renderMarkdownToHtml } from "@/lib/obsidian/parser";
import { Note, ViewMode } from "@/lib/obsidian/types";
import { saveUploadedMedia, resolveMediaUrl, revokeAllActiveMediaUrls, getMediaDetails } from "@/lib/obsidian/media";

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
  const fileAttachmentInputRef = useRef<HTMLInputElement>(null);
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
      const fileType = el.getAttribute("data-media-type") || "file";
      if (!mediaName) return;

      try {
        const objectUrl = await resolveMediaUrl(mediaName);
        if (isCancelled || !el.parentElement) return;

        if (objectUrl) {
          if (fileType === "image") {
            el.innerHTML = `<div class="relative group/media inline-block my-2 max-w-full"><img src="${objectUrl}" alt="${mediaName}" class="rounded-lg max-h-96 max-w-full object-contain border border-white/10 shadow-sm transition" /><a href="${objectUrl}" download="${mediaName}" title="下載原始圖片 (${mediaName})" class="opacity-0 group-hover/media:opacity-100 absolute top-2.5 right-2.5 bg-black/65 hover:bg-black/85 text-slate-200 text-[11px] px-2 py-0.8 rounded-md border border-white/10 backdrop-blur-xs transition-opacity flex items-center gap-1 cursor-pointer select-none"><span>⬇️</span><span>下載原檔</span></a></div>`;
          } else if (fileType === "video") {
            el.innerHTML = `<div class="relative group/media inline-block my-2 max-w-full"><video controls class="rounded-lg max-h-96 max-w-full border border-white/10 shadow-sm" src="${objectUrl}">無法播放此影片格式</video><a href="${objectUrl}" download="${mediaName}" title="下載原始影片 (${mediaName})" class="opacity-0 group-hover/media:opacity-100 absolute top-2.5 right-2.5 bg-black/65 hover:bg-black/85 text-slate-200 text-[11px] px-2 py-0.8 rounded-md border border-white/10 backdrop-blur-xs transition-opacity flex items-center gap-1 cursor-pointer select-none"><span>⬇️</span><span>下載原檔</span></a></div>`;
          } else if (fileType === "audio") {
            el.innerHTML = `<div class="relative group/media inline-flex items-center gap-3 my-2 p-2.5 rounded-lg bg-[#14171d] border border-white/8 shadow-sm"><audio controls class="h-8 max-w-xs" src="${objectUrl}"></audio><a href="${objectUrl}" download="${mediaName}" title="下載音訊" class="bg-white/6 hover:bg-white/10 text-slate-200 text-xs px-2.5 py-1 rounded-md transition flex items-center gap-1 border border-white/10"><span>⬇️</span></a></div>`;
          } else {
            // 通用檔案卡片 (PDF, Excel, Word, ZIP, etc.)
            let icon = "📄";
            let color = "text-purple-300";
            if (fileType === "pdf") { icon = "📕"; color = "text-red-400"; }
            else if (fileType === "excel") { icon = "📊"; color = "text-emerald-400"; }
            else if (fileType === "doc") { icon = "📝"; color = "text-cyan-400"; }
            else if (fileType === "ppt") { icon = "📽️"; color = "text-amber-400"; }
            else if (fileType === "archive") { icon = "📦"; color = "text-indigo-400"; }

            el.innerHTML = `<div class="my-2 flex items-center justify-between gap-3 p-2.5 rounded-lg border border-white/8 bg-[#14161c] hover:border-white/15 transition-all max-w-md group"><div class="flex items-center gap-2.5 overflow-hidden pr-2"><div class="w-8 h-8 rounded-md bg-white/4 border border-white/8 flex items-center justify-center text-sm shrink-0">${icon}</div><div class="overflow-hidden"><div class="font-medium text-xs text-slate-200 truncate group-hover:text-cyan-200 transition-colors">${mediaName}</div><div class="text-[10px] text-slate-500 font-mono mt-0.5 uppercase flex items-center gap-1.5"><span>${fileType.toUpperCase()}</span><span>• 檔案附件</span></div></div></div><a href="${objectUrl}" download="${mediaName}" class="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/6 hover:bg-cyan-950/50 hover:text-cyan-200 text-slate-300 text-xs font-medium border border-white/10 transition-colors cursor-pointer shrink-0"><span>下載</span></a></div>`;
          }
        } else {
          el.innerHTML = `<span class="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/60 px-2.5 py-1 rounded-full inline-flex items-center gap-1 font-mono">⚠️ 檔案「${mediaName}」不存在於本機庫</span>`;
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
        <div className="mb-4 rounded-3xl bg-cyan-950/40 p-4 border border-cyan-800/40 shadow-xl">
          <svg className="w-12 h-12 text-cyan-400" viewBox="0 0 24 24" fill="currentColor">
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
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    setIsUploading(true);
    setUploadMessage(`正在儲存 ${fileList.length} 個檔案至本機資料庫...`);

    try {
      let insertTags = "";
      for (const file of fileList) {
        const saved = await saveUploadedMedia(file);
        insertTags += `\n![[${saved.filename}]]\n`;
      }
      insertTextAtCursor(insertTags);
      setUploadMessage(`已成功儲存並插入 ${fileList.length} 個檔案附件！`);
      setTimeout(() => setUploadMessage(null), 3000);
    } catch (err: any) {
      alert(`儲存檔案失敗: ${err.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleProcessFiles(e.clipboardData.files);
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
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-[#181a20]/95 border border-white/10 px-3.5 py-2 text-xs text-slate-200 shadow-2xl backdrop-blur-md flex items-center gap-2 transition-all duration-200">
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
        className="hidden"
      />

      {/* 頂部操作欄 */}
      <div className="flex items-center justify-between border-b border-white/5 bg-[#0e1013] px-5 py-2.5 select-none relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-white/10 after:to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-serif font-medium text-slate-100 truncate tracking-wide flex items-center gap-2">
            <span>{note.title}</span>
            {note.folder && (
              <span className="text-[11px] font-sans font-normal text-slate-400 bg-white/4 px-2 py-0.5 rounded-[2px]">
                {note.folder}
              </span>
            )}
          </h2>
          <span className="text-[11px] text-slate-500 font-sans hidden sm:inline">
            {charCount} 字 · {wordCount} 詞
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-2.5 py-1 text-xs text-slate-300 hover:text-slate-100 hover:bg-white/4 transition-colors cursor-pointer rounded-[2px] flex items-center gap-1.5"
            title="放檔案或多媒體 (支援任意格式附件)"
          >
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            檔案 / 媒體
          </button>

          <button
            onClick={onOpenGraphView}
            className="px-2.5 py-1 text-xs text-slate-300 hover:text-slate-100 hover:bg-white/4 transition-colors cursor-pointer rounded-[2px] flex items-center gap-1.5"
            title="開啟知識圖譜主視圖"
          >
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            圖譜視圖
          </button>

          <button
            onClick={() => onDownloadMarkdown(note)}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer rounded-[2px]"
            title="下載 Markdown 原文"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          {/* 模式切換器：極簡底線墨痕切換，無厚重外框 */}
          <div className="flex items-center gap-0.5 ml-1 border-l border-white/8 pl-2">
            <button
              onClick={() => setViewMode("edit")}
              className={`px-2 py-0.8 text-xs transition-colors cursor-pointer rounded-[2px] ${
                viewMode === "edit"
                  ? "text-slate-100 font-medium bg-white/[0.06] border-b border-[#0e7490]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              編輯
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`px-2 py-0.8 text-xs transition-colors cursor-pointer hidden md:inline-block rounded-[2px] ${
                viewMode === "split"
                  ? "text-slate-100 font-medium bg-white/[0.06] border-b border-[#0e7490]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              雙欄
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className={`px-2 py-0.8 text-xs transition-colors cursor-pointer rounded-[2px] ${
                viewMode === "preview"
                  ? "text-slate-100 font-medium bg-white/[0.06] border-b border-[#0e7490]"
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
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/4 bg-black/10 px-4 py-1 text-slate-400 text-xs select-none">
          <button
            onClick={() => insertFormatting("**", "**")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors font-bold"
            title="粗體"
          >
            B
          </button>
          <button
            onClick={() => insertFormatting("*", "*")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors italic font-serif"
            title="斜體"
          >
            I
          </button>
          <button
            onClick={() => insertFormatting("## ")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors font-bold"
            title="二級標題"
          >
            H2
          </button>
          <button
            onClick={() => insertFormatting("### ")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors font-bold"
            title="三級標題"
          >
            H3
          </button>
          <button
            onClick={() => insertFormatting("- [ ] ")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors"
            title="待辦清單"
          >
            ☑
          </button>
          <button
            onClick={() => insertFormatting("- ")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors"
            title="無序清單"
          >
            • 清單
          </button>
          <button
            onClick={() => insertFormatting("> ")}
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors"
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
            className="px-2 py-0.5 rounded-[2px] hover:bg-white/4 hover:text-slate-200 transition-colors font-bold"
            title="標籤"
          >
            #標籤
          </button>
          <button
            onClick={() => insertFormatting("![[", "]]")}
            className="rounded-full px-2 py-0.5 hover:bg-slate-800 text-purple-300 hover:text-cyan-200 font-mono"
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
          isDragging ? "ring-2 ring-cyan-500/80 bg-cyan-950/20" : ""
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs border-2 border-dashed border-cyan-500 rounded-2xl pointer-events-none">
            <div className="text-center">
              <svg className="w-12 h-12 text-cyan-400 mx-auto mb-2 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-bold text-cyan-200">放開滑鼠以放入檔案或媒體至本機庫</p>
              <p className="text-xs text-slate-400 mt-1">支援任意檔案格式（PDF、Office、壓縮檔、圖片、影片等）並自動插入 Markdown</p>
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
              placeholder="提筆賦墨：在此揮灑 Markdown，支援任意檔案拖入、[[長卷篇章]] 雙向連結、#標籤、或貼上圖像檔案..."
              className="flex-1 max-w-3xl mx-auto w-full resize-none bg-transparent p-6 font-sans text-[15px] leading-[1.85] text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
          </div>
        )}

        {/* 預覽區 */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div
            ref={previewRef}
            onClick={handlePreviewClick}
            className={`flex flex-col h-full overflow-y-auto p-6 paper-texture ${
              viewMode === "split" ? "w-1/2" : "w-full"
            }`}
          >
            <div
              className="obsidian-preview-container text-slate-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
