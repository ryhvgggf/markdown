"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { BacklinksPanel } from "@/components/obsidian/BacklinksPanel";
import FileTree from "@/components/obsidian/FileTree";
import { GraphView } from "@/components/obsidian/GraphView";
import { MarkdownEditor } from "@/components/obsidian/MarkdownEditor";
import { TagList } from "@/components/obsidian/TagList";
import { getBacklinks, getAllTagsWithCounts } from "@/lib/obsidian/links";
import { parseLinksAndTags } from "@/lib/obsidian/parser";
import {
  getAllNoteMetadata,
  getNoteContent,
  saveNoteToDB,
  deleteNoteFromDB,
  getAllNotesFromDB,
  getCustomFolders,
  saveCustomFolders,
  importVaultBackupToDB,
} from "@/lib/obsidian/db";
import {
  exportNoteMarkdown,
  exportVaultJson,
  getDefaultNotes,
  validateAndParseVaultBackup,
  parseAndRestoreVaultBackup,
} from "@/lib/obsidian/storage";
import { revokeAllActiveMediaUrls } from "@/lib/obsidian/media";
import { Note, NoteMetadata, ViewMode } from "@/lib/obsidian/types";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function MarkdownVaultPage() {
  const [notesMeta, setNotesMeta] = useState<NoteMetadata[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [isLoadingNote, setIsLoadingNote] = useState(false);
  const [targetHeadingSlug, setTargetHeadingSlug] = useState<string | null>(null);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showGraphView, setShowGraphView] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [mainView, setMainView] = useState<"editor" | "graph">("editor");
  const [editorViewMode, setEditorViewMode] = useState<ViewMode>("split");
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);




  function notify(type: "success" | "error" | "info", message: string) {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  }

  const selectNoteById = useCallback(async (noteId: string) => {
    revokeAllActiveMediaUrls();
    setActiveNoteId(noteId);
    setIsLoadingNote(true);

    try {
      const fullNote = await getNoteContent(noteId);
      if (fullNote) {
        setActiveNote(fullNote);
      } else {
        setActiveNote(null);
      }
    } catch (err) {
      console.error("讀取筆記內容失敗:", err);
      notify("error", "讀取筆記內容失敗");
    } finally {
      setIsLoadingNote(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initVault() {
      try {
        let metaList = await getAllNoteMetadata();
        if (metaList.length === 0) {
          const defaults = getDefaultNotes();
          for (const def of defaults) {
            await saveNoteToDB(def);
          }
          metaList = await getAllNoteMetadata();
        }

        if (isMounted) {
          setNotesMeta(metaList);
          if (metaList.length > 0) {
            selectNoteById(metaList[0].id);
          }
        }
      } catch (err: any) {
        console.error("載入知識庫失敗:", err);
        notify("error", "載入知識庫失敗: " + (err.message || err));
      }
    }

    initVault();

    return () => {
      isMounted = false;
      revokeAllActiveMediaUrls();
    };
  }, [selectNoteById]);

  const existingTitles = useMemo(() => {
    return notesMeta.map((n) => n.title);
  }, [notesMeta]);

  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return getBacklinks(activeNote, notesMeta);
  }, [activeNote, notesMeta]);

  const tagsWithCounts = useMemo(() => {
    return getAllTagsWithCounts(notesMeta);
  }, [notesMeta]);

  async function handleCreateNote(initialTitle?: string, folder?: string) {
    let title = initialTitle?.trim();
    if (!title) {
      let counter = 1;
      title = `未命名筆記 ${counter}`;
      while (notesMeta.some((n) => n.title.toLowerCase() === title!.toLowerCase())) {
        counter++;
        title = `未命名筆記 ${counter}`;
      }
    } else {
      const exists = notesMeta.find((n) => n.title.toLowerCase() === title!.toLowerCase());
      if (exists) {
        selectNoteById(exists.id);
        setShowGraphView(false);
        return;
      }
    }

    const now = new Date().toISOString();
    const newNote: Note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      folder: folder || "",
      content: `# ${title}\n\n在此開始撰寫筆記內容...\n支援 [[筆記]] 與 [[筆記#章節]] 雙向連結，亦可自訂資料夾分類管理！\n`,
      tags: [],
      outlinks: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveNoteToDB(newNote);
      const newMeta: NoteMetadata = {
        id: newNote.id,
        title: newNote.title,
        folder: newNote.folder,
        tags: newNote.tags,
        outlinks: newNote.outlinks,
        createdAt: newNote.createdAt,
        updatedAt: newNote.updatedAt,
      };

      setNotesMeta((prev) => [newMeta, ...prev]);
      setActiveNote(newNote);
      setActiveNoteId(newNote.id);
      setShowGraphView(false);
      notify("success", `已建立筆記「${title}」${folder ? ` 於「${folder}」` : ""}`);
    } catch (err: any) {
      notify("error", "建立筆記失敗: " + err.message);
    }
  }

  async function handleMoveNoteFolder(noteId: string, targetFolder: string) {
    try {
      const note = await getNoteContent(noteId);
      if (note) {
        note.folder = targetFolder;
        note.updatedAt = new Date().toISOString();
        await saveNoteToDB(note);
        if (activeNoteId === noteId) {
          setActiveNote({ ...note });
        }
      }
      setNotesMeta((prev) =>
        prev.map((m) => (m.id === noteId ? { ...m, folder: targetFolder } : m))
      );
    } catch (err) {
      console.error("移動筆記資料夾失敗:", err);
    }
  }

  async function handleMoveFolder(sourceFolder: string, targetParent: string) {
    if (!sourceFolder) return;
    if (targetParent === sourceFolder || targetParent.startsWith(sourceFolder + "/")) {
      return;
    }

    const folderName = sourceFolder.split("/").pop() || "";
    const newFolderPath = targetParent ? `${targetParent}/${folderName}` : folderName;
    if (newFolderPath === sourceFolder) return;

    try {
      // 1. 更新 customFolders
      const currentCustom = getCustomFolders();
      let nextCustom = currentCustom.map((f) => {
        if (f === sourceFolder) return newFolderPath;
        if (f.startsWith(sourceFolder + "/")) return newFolderPath + f.slice(sourceFolder.length);
        return f;
      });
      if (!nextCustom.includes(newFolderPath)) {
        nextCustom.push(newFolderPath);
      }
      saveCustomFolders(nextCustom);

      // 2. 批次更新所有筆記
      const allNotes = await getAllNotesFromDB();
      for (const n of allNotes) {
        let changed = false;
        if (n.folder === sourceFolder) {
          n.folder = newFolderPath;
          changed = true;
        } else if (n.folder?.startsWith(sourceFolder + "/")) {
          n.folder = newFolderPath + n.folder.slice(sourceFolder.length);
          changed = true;
        }
        if (changed) {
          n.updatedAt = new Date().toISOString();
          await saveNoteToDB(n);
        }
      }

      setNotesMeta((prev) =>
        prev.map((m) => {
          if (m.folder === sourceFolder) {
            return { ...m, folder: newFolderPath };
          }
          if (m.folder?.startsWith(sourceFolder + "/")) {
            return { ...m, folder: newFolderPath + m.folder.slice(sourceFolder.length) };
          }
          return m;
        })
      );

      if (activeNote) {
        if (activeNote.folder === sourceFolder) {
          setActiveNote({ ...activeNote, folder: newFolderPath });
        } else if (activeNote.folder?.startsWith(sourceFolder + "/")) {
          setActiveNote({
            ...activeNote,
            folder: newFolderPath + activeNote.folder.slice(sourceFolder.length),
          });
        }
      }
    } catch (err) {
      console.error("跨層級移動資料夾失敗:", err);
    }
  }

  async function handleRenameNote(noteId: string, newTitle: string) {
    const targetMeta = notesMeta.find((n) => n.id === noteId);
    if (!targetMeta || targetMeta.title === newTitle) return;
    const oldTitle = targetMeta.title;

    try {
      const fullNote = await getNoteContent(noteId);
      if (fullNote) {
        fullNote.title = newTitle;
        fullNote.updatedAt = new Date().toISOString();
        await saveNoteToDB(fullNote);
        if (activeNoteId === noteId) {
          setActiveNote({ ...fullNote });
        }
      }

      const safeOldTitle = escapeRegex(oldTitle);
      const regex = new RegExp(`\\[\\[${safeOldTitle}(\\|[^\\]]+)?\\]\\]`, "g");

      const allNotes = await getAllNotesFromDB();
      for (const n of allNotes) {
        if (n.id !== noteId && regex.test(n.content)) {
          n.content = n.content.replace(regex, (_match, alias) => `[[${newTitle}${alias || ""}]]`);
          const parsed = parseLinksAndTags(n.content);
          n.outlinks = parsed.outgoingLinks;
          n.tags = parsed.tags;
          n.updatedAt = new Date().toISOString();
          await saveNoteToDB(n);
        }
      }

      const freshMeta = await getAllNoteMetadata();
      setNotesMeta(freshMeta);
      notify("success", `筆記已更名為「${newTitle}」，關聯雙向連結已同步更新`);
    } catch (err: any) {
      notify("error", "重新命名失敗: " + err.message);
    }
  }

  async function handleDeleteNote(noteId: string) {
    const deleted = notesMeta.find((n) => n.id === noteId);
    try {
      await deleteNoteFromDB(noteId);
      const nextMeta = notesMeta.filter((n) => n.id !== noteId);
      setNotesMeta(nextMeta);

      if (activeNoteId === noteId) {
        if (nextMeta.length > 0) {
          selectNoteById(nextMeta[0].id);
        } else {
          setActiveNoteId(null);
          setActiveNote(null);
          revokeAllActiveMediaUrls();
        }
      }
      notify("info", `已刪除筆記「${deleted?.title || ""}」`);
    } catch (err: any) {
      notify("error", "刪除筆記失敗: " + err.message);
    }
  }

  function handleUpdateContent(newContent: string) {
    if (!activeNote) return;

    const parsed = parseLinksAndTags(newContent);
    const updatedNote: Note = {
      ...activeNote,
      content: newContent,
      tags: parsed.tags,
      outlinks: parsed.outgoingLinks,
      updatedAt: new Date().toISOString(),
    };

    setActiveNote(updatedNote);

    setNotesMeta((prev) =>
      prev.map((meta) =>
        meta.id === updatedNote.id
          ? {
              ...meta,
              tags: updatedNote.tags,
              outlinks: updatedNote.outlinks,
              updatedAt: updatedNote.updatedAt,
            }
          : meta
      )
    );

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveNoteToDB(updatedNote);
      } catch (err) {
        console.error("儲存筆記失敗:", err);
      }
    }, 300);
  }

  function handleNavigateToNoteTitle(title: string, headingSlug?: string) {
    if (headingSlug) setTargetHeadingSlug(headingSlug);
    const cleanTitle = title.trim();
    const existing = notesMeta.find(
      (n) => n.title.toLowerCase() === cleanTitle.toLowerCase()
    );

    if (existing) {
      selectNoteById(existing.id);
      setShowGraphView(false);
    } else {
      if (window.confirm(`筆記「${cleanTitle}」尚未建立，是否立即新增？`)) {
        handleCreateNote(cleanTitle);
      }
    }
  }

  async function handleExportVault() {
    try {
      await exportVaultJson("Markdown-Vault");
      notify("success", "已成功匯出知識庫備份檔");
    } catch (err: any) {
      notify("error", "匯出失敗: " + err.message);
    }
  }

  async function handleImportVault(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await parseAndRestoreVaultBackup(text);

      const refreshed = await getAllNoteMetadata();
      setNotesMeta(refreshed);
      if (refreshed.length > 0) {
        selectNoteById(refreshed[0].id);
      }
      setShowBackupModal(false);
      const mediaInfo = result.mediaCount > 0 ? `、${result.mediaCount} 個照片/影片` : "";
      notify("success", `成功還原 ${result.notes.length} 篇筆記${mediaInfo}！`);
    } catch (err: any) {
      notify("error", `匯入失敗: ${err.message || "檔案格式不符"}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* 浮動通知提示 Toast */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-[#181a20]/95 border border-white/10 px-3.5 py-2 text-xs text-slate-200 shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span className="text-slate-300 font-mono">✓</span>
          <span>{notification.message}</span>
        </div>
      )}


      {/* 左側檔案樹導覽欄 */}
      <aside className="w-64 flex-shrink-0 flex flex-col h-full border-r border-slate-800 bg-slate-900/50">
        <FileTree
          notes={notesMeta}
          activeNoteId={activeNoteId}
          onSelectNote={(id) => selectNoteById(id)}
          onCreateNote={handleCreateNote}
          onDeleteNote={handleDeleteNote}
          onRenameNote={handleRenameNote}
          onMoveNoteFolder={handleMoveNoteFolder}
          onMoveFolder={handleMoveFolder}
          selectedTag={selectedTag}
          onClearTagFilter={() => setSelectedTag(null)}
        />

        {/* 底部功能捷徑 */}
        <div className="border-t border-white/6 p-2 bg-[#121418] flex items-center justify-between text-xs text-slate-400 select-none">
          <button
            onClick={() => setShowBackupModal(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 hover:text-slate-200 transition-colors cursor-pointer text-[11px]"
            title="備份與還原知識庫"
          >
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            備份 / 還原
          </button>


          <button
            onClick={() => setMainView(mainView === "editor" ? "graph" : "editor")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer text-[11px] ${
              mainView === "graph"
                ? "bg-cyan-950/60 text-cyan-200"
                : "hover:bg-white/5 hover:text-slate-200 text-slate-400"
            }`}
            title="切換知識圖譜主視圖"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            圖譜視圖
          </button>
        </div>
      </aside>

      {/* 中央主區域：Markdown 編輯器 / 圖譜檢視 */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative bg-[#0d0f12]">
        {mainView === "graph" ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/5 bg-[#101216] z-20">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMainView("editor")}
                  className="flex items-center gap-1 px-2 py-0.8 text-xs text-slate-300 hover:text-slate-100 transition-colors cursor-pointer rounded-[2px]"
                >
                  <span>←</span>
                  <span>返回編輯</span>
                </button>
                <span className="text-xs font-serif text-slate-400 ml-2">知識圖譜長卷 · 獨立主視圖</span>
              </div>
              <button
                onClick={() => setShowGraphView(true)}
                className="px-2 py-0.8 text-xs text-slate-400 hover:text-slate-200 transition-colors rounded-[2px]"
                title="全螢幕開啟"
              >
                全螢幕
              </button>
            </div>
            <div className="flex-1 h-full w-full">
              <GraphView
                notes={notesMeta}
                activeNoteId={activeNoteId}
                onSelectNote={(id) => {
                  selectNoteById(id);
                  setMainView("editor");
                }}
              />
            </div>
          </div>
        ) : isLoadingNote ? (
          <div className="flex-1 flex items-center justify-center bg-[#0d0f12] text-slate-400 gap-2">
            <svg className="w-4 h-4 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeWidth="2.5" strokeDasharray="32" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-slate-400">正在調入篇章...</span>
          </div>
        ) : (
          <MarkdownEditor
            note={activeNote}
            existingTitles={existingTitles}
            onUpdateContent={handleUpdateContent}
            targetHeadingSlug={targetHeadingSlug}
            onClearTargetHeadingSlug={() => setTargetHeadingSlug(null)}
            onNavigateToNoteTitle={handleNavigateToNoteTitle}
            onDownloadMarkdown={exportNoteMarkdown}
            onOpenGraphView={() => setMainView("graph")}
            onSelectTag={(t) => setSelectedTag(t)}
          />
        )}
      </main>

      {/* 右側欄：反向連結 (Backlinks) 與 標籤 (Tags) */}
      {showRightPanel ? (
        <aside className="w-72 flex-shrink-0 flex flex-col h-full border-l border-white/6 bg-[#121418]">
          <div className="flex items-center justify-between border-b border-white/6 px-3 py-2.5 text-xs font-semibold text-slate-400">
            <span>關聯資訊</span>
            <button
              onClick={() => setShowRightPanel(false)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              title="收合右側欄"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 flex flex-col overflow-y-auto divide-y divide-white/6">
            {/* 反向連結區塊 */}
            <div className="p-3">
              <BacklinksPanel
                activeNote={activeNote}
                backlinks={backlinks}
                allNotes={notesMeta}
                onSelectNote={(id) => selectNoteById(id)}
                onNavigateToNoteTitle={handleNavigateToNoteTitle}
              />
            </div>

            {/* 標籤清單區塊 */}
            <div className="p-3">
              <TagList
                tagsWithCounts={tagsWithCounts}
                selectedTag={selectedTag}
                onSelectTag={(t) => setSelectedTag(t)}
              />
            </div>
          </div>
        </aside>
      ) : (
        <button
          onClick={() => setShowRightPanel(true)}
          className="absolute right-0 top-12 z-20 rounded-l-lg bg-slate-800 border-l border-t border-b border-slate-700 p-1.5 text-xs text-slate-400 hover:text-cyan-300"
          title="展開關聯與標籤"
        >
          ◀
        </button>
      )}

      {/* 全螢幕/彈出式圖譜檢視 (Graph View Modal) */}
      {showGraphView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-5xl h-[85vh] rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-[#0c0d10] flex flex-col">
            <GraphView
              notes={notesMeta}
              activeNoteId={activeNoteId}
              onSelectNote={(id) => {
                selectNoteById(id);
                setShowGraphView(false);
              }}
              onClose={() => setShowGraphView(false)}
            />
          </div>
        </div>
      )}


      {/* 備份與還原 Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-[#14161c]/95 border border-white/10 p-5 shadow-2xl text-slate-200 backdrop-blur-md ring-1 ring-white/5">
            <div className="flex items-center justify-between pb-3 border-b border-white/8">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
                </svg>
                本機知識庫備份與管理
              </h3>
              <button
                onClick={() => setShowBackupModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs leading-relaxed text-slate-300">
              <p>
                知識庫採用高效 <strong className="text-rose-300">IndexedDB</strong> 兩層儲存架構，資料保存於瀏覽器本機沙盒中。即使開啟龐大筆記與圖譜也不會造成卡頓。
              </p>

              <div className="rounded-lg bg-white/3 p-3 border border-white/8 rounded-lg space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">目前筆記數量:</span>
                  <span className="font-mono text-slate-400 font-bold">{notesMeta.length} 篇</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">標籤數量:</span>
                  <span className="font-mono text-slate-400 font-bold">{tagsWithCounts.length} 個</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={handleExportVault}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#be123c] hover:bg-[#9f1239] py-2 text-xs font-medium text-white transition-colors cursor-pointer shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  匯出整座知識庫 (JSON 備份檔)
                </button>

                <label className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/4 hover:bg-white/8 py-2 text-xs font-medium text-slate-200 transition-colors border border-white/8 cursor-pointer">
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  還原 / 匯入備份檔
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportVault}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
