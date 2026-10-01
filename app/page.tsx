"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BacklinksPanel } from "@/components/obsidian/BacklinksPanel";
import FileTree from "@/components/obsidian/FileTree";
import { GraphView } from "@/components/obsidian/GraphView";
import { MarkdownEditor } from "@/components/obsidian/MarkdownEditor";
import { TagList } from "@/components/obsidian/TagList";
import { MobileBottomBar } from "@/components/obsidian/MobileBottomBar";

import {
  deleteNoteFromDB,
  getAllNoteMetadata,
  getAllNotesFromDB,
  getCustomFolders,
  getNoteContent,
  saveCustomFolders,
  saveNoteToDB,
} from "@/lib/obsidian/db";

import {
  getAllTagsWithCounts,
  getBacklinks,
} from "@/lib/obsidian/links";

import {
  extractMediaReferences,
  parseLinksAndTags,
} from "@/lib/obsidian/parser";

import {
  deleteSavedMedia,
  getMediaDetails,
  revokeAllActiveMediaUrls,
} from "@/lib/obsidian/media";

import {
  exportNoteMarkdown,
  exportVaultJson,
  initVaultStorage,
  parseAndRestoreVaultBackup,
} from "@/lib/obsidian/storage";

import {
  Note,
  NoteMetadata,
} from "@/lib/obsidian/types";

function escapeRegex(text: string): string {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export default function MarkdownVaultPage() {
  const [notesMeta, setNotesMeta] =
    useState<NoteMetadata[]>([]);

  const [activeNoteId, setActiveNoteId] =
    useState<string | null>(null);

  const [activeNote, setActiveNote] =
    useState<Note | null>(null);

  const [isLoadingNote, setIsLoadingNote] =
    useState(false);

  const [targetHeadingSlug, setTargetHeadingSlug] =
    useState<string | null>(null);

  const [selectedTag, setSelectedTag] =
    useState<string | null>(null);

  const [showRightPanel, setShowRightPanel] =
    useState(true);

  const [showBackupModal, setShowBackupModal] =
    useState(false);

  const [mainView, setMainView] =
    useState<"editor" | "graph">("editor");

  /*
   * Mobile UI state
   */
  const [showMobileNotes, setShowMobileNotes] =
    useState(false);

  const [showMobileRelations, setShowMobileRelations] =
    useState(false);

  const [notification, setNotification] =
    useState<{
      type: "success" | "error" | "info";
      message: string;
    } | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const saveTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const notify = useCallback(
    (
      type: "success" | "error" | "info",
      message: string
    ) => {
      setNotification({
        type,
        message,
      });

      window.setTimeout(() => {
        setNotification((current) =>
          current?.message === message
            ? null
            : current
        );
      }, 3600);
    },
    []
  );

  /*
   * ---------------------------------------------------------
   * Load note
   * ---------------------------------------------------------
   */

  const selectNoteById = useCallback(
    async (noteId: string) => {
      revokeAllActiveMediaUrls();

      setActiveNoteId(noteId);
      setIsLoadingNote(true);

      try {
        const full =
          await getNoteContent(noteId);

        setActiveNote(full);
      } catch (error) {
        console.error(
          "讀取筆記失敗:",
          error
        );

        notify(
          "error",
          "讀取筆記失敗"
        );
      } finally {
        setIsLoadingNote(false);
      }
    },
    [notify]
  );

  /*
   * ---------------------------------------------------------
   * Initialisation
   * ---------------------------------------------------------
   */

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const initResult =
          await initVaultStorage();

        const meta =
          await getAllNoteMetadata();

        if (!mounted) {
          return;
        }

        setNotesMeta(meta);

        if (
          initResult.migratedCount > 0
        ) {
          notify(
            "success",
            `已將 ${initResult.migratedCount} 篇舊筆記遷移至 IndexedDB`
          );
        }

        if (meta.length > 0) {
          await selectNoteById(
            meta[0].id
          );
        }
      } catch (error: any) {
        console.error(
          "初始化知識庫失敗:",
          error
        );

        notify(
          "error",
          `載入知識庫失敗：${
            error?.message || error
          }`
        );
      }
    };

    void init();

    return () => {
      mounted = false;

      if (saveTimeoutRef.current) {
        clearTimeout(
          saveTimeoutRef.current
        );
      }

      revokeAllActiveMediaUrls();
    };
  }, [
    notify,
    selectNoteById,
  ]);

  /*
   * ---------------------------------------------------------
   * Derived data
   * ---------------------------------------------------------
   */

  const existingTitles = useMemo(
    () =>
      notesMeta.map(
        (note) => note.title
      ),
    [notesMeta]
  );

  const backlinks = useMemo(
    () =>
      activeNote
        ? getBacklinks(
            activeNote,
            notesMeta
          )
        : [],
    [
      activeNote,
      notesMeta,
    ]
  );

  const tagsWithCounts = useMemo(
    () =>
      getAllTagsWithCounts(
        notesMeta
      ),
    [notesMeta]
  );

  /*
   * ---------------------------------------------------------
   * Mobile helpers
   * ---------------------------------------------------------
   */

  const closeMobilePanels =
    useCallback(() => {
      setShowMobileNotes(false);
      setShowMobileRelations(false);
    }, []);

  const handleMobileSelectNote =
    useCallback(
      (id: string) => {
        closeMobilePanels();

        void selectNoteById(id);

        setMainView("editor");
      },
      [
        closeMobilePanels,
        selectNoteById,
      ]
    );

  /*
   * ---------------------------------------------------------
   * Create note
   * ---------------------------------------------------------
   */

  async function handleCreateNote(
    initialTitle?: string,
    folder?: string
  ) {
    let title =
      initialTitle?.trim();

    if (!title) {
      let counter = 1;

      title =
        `未命名筆記 ${counter}`;

      while (
        notesMeta.some(
          (note) =>
            note.title
              .toLowerCase() ===
            title?.toLowerCase()
        )
      ) {
        counter += 1;

        title =
          `未命名筆記 ${counter}`;
      }
    } else {
      const existing =
        notesMeta.find(
          (note) =>
            note.title
              .toLowerCase() ===
            title?.toLowerCase()
        );

      if (existing) {
        await selectNoteById(
          existing.id
        );

        setMainView("editor");

        return;
      }
    }

    const now =
      new Date().toISOString();

    const newNote: Note = {
      id:
        `note-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      title,

      folder:
        normalizeFolderPath(
          folder || ""
        ),

      content:
        `# ${title}\n\n` +
        "在此開始撰寫筆記內容...\n",

      tags: [],

      outlinks: [],

      createdAt: now,

      updatedAt: now,
    };

    try {
      await saveNoteToDB(
        newNote
      );

      const meta =
        await getAllNoteMetadata();

      setNotesMeta(meta);

      setActiveNote(newNote);

      setActiveNoteId(
        newNote.id
      );

      setMainView("editor");

      closeMobilePanels();

      notify(
        "success",
        `已建立筆記「${title}」`
      );
    } catch (error: any) {
      notify(
        "error",
        `建立筆記失敗：${
          error?.message || error
        }`
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Move note
   * ---------------------------------------------------------
   */

  async function handleMoveNoteFolder(
    noteId: string,
    targetFolder: string
  ) {
    const target =
      normalizeFolderPath(
        targetFolder
      );

    try {
      const note =
        await getNoteContent(
          noteId
        );

      if (!note) {
        return;
      }

      note.folder = target;

      note.updatedAt =
        new Date().toISOString();

      await saveNoteToDB(
        note
      );

      setNotesMeta(
        (previous) =>
          previous.map(
            (meta) =>
              meta.id === noteId
                ? {
                    ...meta,
                    folder: target,
                    updatedAt:
                      note.updatedAt,
                  }
                : meta
          )
      );

      if (
        activeNoteId === noteId
      ) {
        setActiveNote({
          ...note,
        });
      }
    } catch (error) {
      console.error(
        "移動筆記失敗:",
        error
      );

      notify(
        "error",
        "移動筆記失敗"
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Move folder
   * ---------------------------------------------------------
   */

  async function handleMoveFolder(
    sourceFolder: string,
    targetParent: string
  ) {
    const source =
      normalizeFolderPath(
        sourceFolder
      );

    const target =
      normalizeFolderPath(
        targetParent
      );

    if (!source) {
      return;
    }

    if (
      target === source ||
      target.startsWith(
        `${source}/`
      )
    ) {
      notify(
        "error",
        "資料夾不能移入自己或自己的子資料夾"
      );

      return;
    }

    const folderName =
      source.split("/").pop() ||
      "";

    const newPath =
      normalizeFolderPath(
        target
          ? `${target}/${folderName}`
          : folderName
      );

    if (newPath === source) {
      return;
    }

    const knownFolders =
      new Set<string>(
        getCustomFolders().map(
          normalizeFolderPath
        )
      );

    for (const meta of notesMeta) {
      if (meta.folder) {
        knownFolders.add(
          normalizeFolderPath(
            meta.folder
          )
        );
      }
    }

    if (
      knownFolders.has(
        newPath
      )
    ) {
      notify(
        "error",
        "移動失敗：目標位置已存在同名資料夾"
      );

      return;
    }

    try {
      const custom =
        getCustomFolders();

      const nextCustom =
        custom.map(
          (folder) => {
            if (
              folder ===
              source
            ) {
              return newPath;
            }

            if (
              folder.startsWith(
                `${source}/`
              )
            ) {
              return (
                newPath +
                folder.slice(
                  source.length
                )
              );
            }

            return folder;
          }
        );

      saveCustomFolders(
        nextCustom
      );

      const allNotes =
        await getAllNotesFromDB();

      for (const note of allNotes) {
        let changed = false;

        if (
          note.folder ===
          source
        ) {
          note.folder =
            newPath;

          changed = true;
        } else if (
          note.folder?.startsWith(
            `${source}/`
          )
        ) {
          note.folder =
            newPath +
            note.folder.slice(
              source.length
            );

          changed = true;
        }

        if (changed) {
          note.updatedAt =
            new Date().toISOString();

          await saveNoteToDB(
            note
          );
        }
      }

      const refreshed =
        await getAllNoteMetadata();

      setNotesMeta(
        refreshed
      );

      if (activeNoteId) {
        const latest =
          await getNoteContent(
            activeNoteId
          );

        setActiveNote(
          latest
        );
      }
    } catch (error) {
      console.error(
        "移動資料夾失敗:",
        error
      );

      notify(
        "error",
        "移動資料夾失敗"
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Rename note
   * ---------------------------------------------------------
   */

  async function handleRenameNote(
    noteId: string,
    newTitle: string
  ) {
    const cleanTitle =
      newTitle.trim();

    if (!cleanTitle) {
      notify(
        "error",
        "筆記名稱不能為空"
      );

      return;
    }

    const target =
      notesMeta.find(
        (note) =>
          note.id === noteId
      );

    if (!target) {
      return;
    }

    if (
      notesMeta.some(
        (note) =>
          note.id !== noteId &&
          note.title
            .trim()
            .toLowerCase() ===
            cleanTitle.toLowerCase()
      )
    ) {
      notify(
        "error",
        "已存在同名筆記"
      );

      return;
    }

    const oldTitle =
      target.title;

    if (
      oldTitle === cleanTitle
    ) {
      return;
    }

    try {
      const allNotes =
        await getAllNotesFromDB();

      const safeOld =
        escapeRegex(
          oldTitle
        );

      const linkRegex =
        new RegExp(
          `\\[\\[${safeOld}((?:#[^|\\]]+)?(?:\\|[^\\]]+)?)\\]\\]`,
          "gi"
        );

      for (const note of allNotes) {
        let changed = false;

        if (
          note.id === noteId
        ) {
          note.title =
            cleanTitle;

          changed = true;
        }

        const nextContent =
          note.content.replace(
            linkRegex,
            (
              _match,
              suffix
            ) =>
              `[[${cleanTitle}${
                suffix || ""
              }]]`
          );

        if (
          nextContent !==
          note.content
        ) {
          note.content =
            nextContent;

          changed = true;
        }

        if (changed) {
          const parsed =
            parseLinksAndTags(
              note.content
            );

          note.tags =
            parsed.tags;

          note.outlinks =
            parsed.outgoingLinks;

          note.updatedAt =
            new Date().toISOString();

          await saveNoteToDB(
            note
          );
        }
      }

      const refreshed =
        await getAllNoteMetadata();

      setNotesMeta(
        refreshed
      );

      if (activeNoteId) {
        setActiveNote(
          await getNoteContent(
            activeNoteId
          )
        );
      }

      notify(
        "success",
        `筆記已更名為「${cleanTitle}」，雙向連結已同步更新`
      );
    } catch (error: any) {
      notify(
        "error",
        `重新命名失敗：${
          error?.message || error
        }`
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Media cleanup
   * ---------------------------------------------------------
   */

  async function resolveMediaIds(
    refs: string[]
  ): Promise<Set<string>> {
    const result =
      new Set<string>();

    for (const ref of refs) {
      try {
        const record =
          await getMediaDetails(
            ref
          );

        result.add(
          record?.id || ref
        );
      } catch {
        result.add(ref);
      }
    }

    return result;
  }

  async function handleDeleteNote(
    noteId: string
  ) {
    const deletedMeta =
      notesMeta.find(
        (note) =>
          note.id === noteId
      );

    try {
      const deletedNote =
        await getNoteContent(
          noteId
        );

      const deletedRefs =
        deletedNote
          ? extractMediaReferences(
              deletedNote.content
            )
          : [];

      await deleteNoteFromDB(
        noteId
      );

      if (
        deletedRefs.length > 0
      ) {
        const remainingNotes =
          await getAllNotesFromDB();

        const remainingRefs =
          remainingNotes.flatMap(
            (note) =>
              extractMediaReferences(
                note.content
              )
          );

        const [
          deletedIds,
          remainingIds,
        ] =
          await Promise.all([
            resolveMediaIds(
              deletedRefs
            ),
            resolveMediaIds(
              remainingRefs
            ),
          ]);

        for (
          const ref of deletedRefs
        ) {
          const record =
            await getMediaDetails(
              ref
            );

          const resolvedId =
            record?.id || ref;

          if (
            deletedIds.has(
              resolvedId
            ) &&
            !remainingIds.has(
              resolvedId
            )
          ) {
            await deleteSavedMedia(
              ref
            );
          }
        }
      }

      const refreshed =
        await getAllNoteMetadata();

      setNotesMeta(
        refreshed
      );

      if (
        activeNoteId === noteId
      ) {
        if (
          refreshed.length > 0
        ) {
          await selectNoteById(
            refreshed[0].id
          );
        } else {
          setActiveNoteId(
            null
          );

          setActiveNote(
            null
          );

          revokeAllActiveMediaUrls();
        }
      }

      notify(
        "info",
        `已刪除筆記「${
          deletedMeta?.title ||
          ""
        }」`
      );
    } catch (error: any) {
      notify(
        "error",
        `刪除筆記失敗：${
          error?.message || error
        }`
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Editor update / autosave
   * ---------------------------------------------------------
   */

  function handleUpdateContent(
    newContent: string
  ) {
    if (!activeNote) {
      return;
    }

    const parsed =
      parseLinksAndTags(
        newContent
      );

    const updated: Note = {
      ...activeNote,

      content: newContent,

      tags: parsed.tags,

      outlinks:
        parsed.outgoingLinks,

      updatedAt:
        new Date().toISOString(),
    };

    setActiveNote(
      updated
    );

    setNotesMeta(
      (previous) =>
        previous.map(
          (meta) =>
            meta.id === updated.id
              ? {
                  ...meta,
                  tags:
                    updated.tags,
                  outlinks:
                    updated.outlinks,
                  charCount:
                    updated.content
                      .length,
                  updatedAt:
                    updated.updatedAt,
                }
              : meta
        )
    );

    if (saveTimeoutRef.current) {
      clearTimeout(
        saveTimeoutRef.current
      );
    }

    saveTimeoutRef.current =
      setTimeout(
        async () => {
          try {
            await saveNoteToDB(
              updated
            );
          } catch (error) {
            console.error(
              "儲存筆記失敗:",
              error
            );

            notify(
              "error",
              "自動儲存失敗"
            );
          }
        },
        300
      );
  }

  /*
   * ---------------------------------------------------------
   * WikiLink navigation
   * ---------------------------------------------------------
   */

  function handleNavigateToNoteTitle(
    title: string,
    headingSlug?: string
  ) {
    if (headingSlug) {
      setTargetHeadingSlug(
        headingSlug
      );
    }

    const cleanTitle =
      title.trim();

    const existing =
      notesMeta.find(
        (note) =>
          note.title
            .toLowerCase() ===
          cleanTitle.toLowerCase()
      );

    if (existing) {
      closeMobilePanels();

      void selectNoteById(
        existing.id
      );

      setMainView("editor");

      return;
    }

    if (
      window.confirm(
        `筆記「${cleanTitle}」尚未建立，是否立即新增？`
      )
    ) {
      void handleCreateNote(
        cleanTitle
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * Backup
   * ---------------------------------------------------------
   */

  async function handleExportVault() {
    try {
      await exportVaultJson(
        "Markdown-Vault"
      );

      notify(
        "success",
        "已成功匯出完整知識庫備份"
      );
    } catch (error: any) {
      notify(
        "error",
        `匯出失敗：${
          error?.message || error
        }`
      );
    }
  }

  async function handleImportVault(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    const confirmed =
      window.confirm(
        "還原備份會以備份檔內容取代目前筆記、資料夾與附件。\n\n確定繼續嗎？"
      );

    if (!confirmed) {
      event.target.value = "";
      return;
    }

    try {
      const text =
        await file.text();

      const result =
        await parseAndRestoreVaultBackup(
          text
        );

      revokeAllActiveMediaUrls();

      const refreshed =
        await getAllNoteMetadata();

      setNotesMeta(
        refreshed
      );

      setSelectedTag(null);

      setShowBackupModal(false);

      closeMobilePanels();

      if (
        refreshed.length > 0
      ) {
        await selectNoteById(
          refreshed[0].id
        );
      } else {
        setActiveNoteId(
          null
        );

        setActiveNote(
          null
        );
      }

      notify(
        "success",
        `已還原 ${result.notes.length} 篇筆記、${result.folderCount} 個資料夾、${result.mediaCount} 個附件`
      );
    } catch (error: any) {
      notify(
        "error",
        `匯入失敗：${
          error?.message ||
          "檔案格式不符"
        }`
      );
    } finally {
      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * Render
   * ---------------------------------------------------------
   */

  return (
    <div className="markdown-vault-root flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">

      {/* Mobile overlay */}
      {showMobileNotes && (
        <button
          type="button"
          aria-label="關閉筆記選單"
          className="mobile-drawer-overlay"
          onClick={() =>
            setShowMobileNotes(false)
          }
        />
      )}

      {showMobileRelations && (
        <button
          type="button"
          aria-label="關閉關聯資訊"
          className="mobile-drawer-overlay"
          onClick={() =>
            setShowMobileRelations(false)
          }
        />
      )}

      {/* Notification */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-[14000] flex items-center gap-2 border px-3.5 py-2 text-xs shadow-2xl ${
            notification.type ===
            "error"
              ? "border-red-500/20 bg-[#1a1111]/95 text-red-200"
              : "border-cyan-700/20 bg-[#121415]/95 text-slate-200"
          }`}
        >
          <span className="font-serif">
            {notification.type ===
            "error"
              ? "!"
              : "✓"}
          </span>

          <span>
            {notification.message}
          </span>
        </div>
      )}

      {/* =====================================================
          LEFT SIDEBAR
          ===================================================== */}

      <aside
        className={`
          app-sidebar
          flex
          h-full
          w-64
          shrink-0
          flex-col
          border-r
          border-slate-800
          bg-slate-900/50

          ${
            showMobileNotes
              ? "mobile-sidebar-open"
              : ""
          }
        `}
      >
        <FileTree
          notes={notesMeta}
          activeNoteId={
            activeNoteId
          }

          onSelectNote={
            handleMobileSelectNote
          }

          onCreateNote={
            handleCreateNote
          }

          onDeleteNote={(id) =>
            void handleDeleteNote(
              id
            )
          }

          onRenameNote={(
            id,
            title
          ) =>
            void handleRenameNote(
              id,
              title
            )
          }

          onMoveNoteFolder={(
            id,
            folder
          ) =>
            void handleMoveNoteFolder(
              id,
              folder
            )
          }

          onMoveFolder={(
            source,
            parent
          ) =>
            void handleMoveFolder(
              source,
              parent
            )
          }

          selectedTag={
            selectedTag
          }

          onClearTagFilter={() =>
            setSelectedTag(null)
          }
        />

        <div className="flex items-center justify-between border-t border-white/5 bg-black/20 p-2 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={() =>
              setShowBackupModal(
                true
              )
            }
            className="px-2 py-1 hover:text-slate-200"
          >
            備份 / 還原
          </button>

          <button
            type="button"
            onClick={() =>
              setMainView(
                mainView ===
                "editor"
                  ? "graph"
                  : "editor"
              )
            }
            className={`px-2 py-1 ${
              mainView ===
              "graph"
                ? "text-cyan-200"
                : "hover:text-slate-200"
            }`}
          >
            圖譜視圖
          </button>
        </div>
      </aside>

      {/* =====================================================
          MAIN
          ===================================================== */}

      <main className="app-main relative flex h-full min-w-0 flex-1 flex-col bg-[#0d0f12]">
        {mainView ===
        "graph" ? (
          <div className="relative flex h-full flex-1 flex-col overflow-hidden">
            <div className="z-20 flex items-center border-b border-white/5 bg-black/25 px-5 py-2.5">
              <button
                type="button"
                onClick={() =>
                  setMainView(
                    "editor"
                  )
                }
                className="text-xs text-slate-400 hover:text-slate-100"
              >
                ← 返回編輯
              </button>
            </div>

            <div className="min-h-0 flex-1">
              <GraphView
                notes={
                  notesMeta
                }

                activeNoteId={
                  activeNoteId
                }

                onSelectNote={(
                  id
                ) => {
                  closeMobilePanels();

                  void selectNoteById(
                    id
                  );

                  setMainView(
                    "editor"
                  );
                }}
              />
            </div>
          </div>
        ) : isLoadingNote ? (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
            正在載入篇章…
          </div>
        ) : (
          <MarkdownEditor
            note={activeNote}

            existingTitles={
              existingTitles
            }

            targetHeadingSlug={
              targetHeadingSlug
            }

            onClearTargetHeadingSlug={() =>
              setTargetHeadingSlug(
                null
              )
            }

            onUpdateContent={
              handleUpdateContent
            }

            onNavigateToNoteTitle={
              handleNavigateToNoteTitle
            }

            onDownloadMarkdown={
              exportNoteMarkdown
            }

            onOpenGraphView={() =>
              setMainView(
                "graph"
              )
            }

            onSelectTag={(tag) =>
              setSelectedTag(
                tag
              )
            }
          />
        )}
      </main>

      {/* =====================================================
          RIGHT PANEL
          ===================================================== */}

      {showRightPanel ? (
        <aside
          className={`
            app-right-panel
            flex
            h-full
            w-72
            shrink-0
            flex-col
            border-l
            border-white/5
            bg-[#121418]

            ${
              showMobileRelations
                ? "mobile-right-panel-open"
                : ""
            }
          `}
        >
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2.5 text-xs text-slate-400">
            <span>
              關聯資訊
            </span>

            <button
              type="button"
              onClick={() => {
                setShowRightPanel(
                  false
                );

                setShowMobileRelations(
                  false
                );
              }}
              className="text-slate-500 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-3">
              <BacklinksPanel
                activeNote={
                  activeNote
                }

                backlinks={
                  backlinks
                }

                allNotes={
                  notesMeta
                }

                onSelectNote={(
                  id
                ) => {
                  closeMobilePanels();

                  void selectNoteById(
                    id
                  );
                }}

                onNavigateToNoteTitle={
                  handleNavigateToNoteTitle
                }
              />
            </div>

            <div className="border-t border-white/5 p-3">
              <TagList
                tagsWithCounts={
                  tagsWithCounts
                }

                selectedTag={
                  selectedTag
                }

                onSelectTag={(
                  tag
                ) =>
                  setSelectedTag(
                    tag
                  )
                }
              />
            </div>
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() =>
            setShowRightPanel(
              true
            )
          }
          className="absolute right-0 top-12 z-20 border border-r-0 border-white/10 bg-[#111416] px-1.5 py-2 text-xs text-slate-500 hover:text-cyan-300"
        >
          ◀
        </button>
      )}

      {/* =====================================================
          MOBILE BOTTOM BAR
          ===================================================== */}

      <MobileBottomBar
        activeView={mainView}

        onOpenNotes={() => {
          setShowMobileRelations(
            false
          );

          setShowMobileNotes(
            true
          );
        }}

        onCreateNote={() => {
          closeMobilePanels();

          void handleCreateNote();
        }}

        onOpenGraph={() => {
          closeMobilePanels();

          setMainView(
            "graph"
          );
        }}

        onOpenRelations={() => {
          setShowMobileNotes(
            false
          );

          setShowRightPanel(
            true
          );

          setShowMobileRelations(
            true
          );
        }}
      />

      {/* =====================================================
          BACKUP MODAL
          ===================================================== */}

      {showBackupModal && (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-serif text-sm text-white">
                本機知識庫備份與管理
              </h3>

              <button
                type="button"
                onClick={() =>
                  setShowBackupModal(
                    false
                  )
                }
                className="text-slate-500 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 py-4 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>
                  筆記
                </span>

                <span className="font-mono">
                  {
                    notesMeta.length
                  }
                </span>
              </div>

              <div className="flex justify-between">
                <span>
                  標籤
                </span>

                <span className="font-mono">
                  {
                    tagsWithCounts.length
                  }
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  void handleExportVault()
                }
                className="w-full border border-cyan-700/30 py-2 text-cyan-200 hover:bg-cyan-950/20"
              >
                匯出完整 JSON 備份
              </button>

              <label className="block w-full cursor-pointer border border-white/10 py-2 text-center text-slate-300 hover:bg-white/[0.03]">
                還原 / 匯入備份

                <input
                  ref={
                    fileInputRef
                  }
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(
                    event
                  ) =>
                    void handleImportVault(
                      event
                    )
                  }
                />
              </label>

              <p className="text-[10px] leading-relaxed text-slate-600">
                還原會完整取代目前的筆記、資料夾與附件。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
