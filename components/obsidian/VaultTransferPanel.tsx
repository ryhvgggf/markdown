"use client";

import {
  useMemo,
  useRef,
  useState,
} from "react";

import { createPortal } from "react-dom";

import {
  exportSelectedNotesZip,
  exportVaultZip,
  importNotesZip,
  parseAndRestoreVaultBackup,
  restoreVaultZip,
} from "@/lib/obsidian/storage";

import { revokeAllActiveMediaUrls } from "@/lib/obsidian/media";
import { NoteMetadata } from "@/lib/obsidian/types";

interface VaultTransferPanelProps {
  notesMeta: NoteMetadata[];
  mainView: "editor" | "graph";
  onToggleGraph: () => void;
  onDataChanged: (
    preferredNoteId?: string
  ) => void | Promise<void>;
}

export function VaultTransferPanel({
  notesMeta,
  mainView,
  onToggleGraph,
  onDataChanged,
}: VaultTransferPanelProps) {
  const restoreInputRef =
    useRef<HTMLInputElement>(null);

  const importNotesInputRef =
    useRef<HTMLInputElement>(null);

  const [
    showBackupModal,
    setShowBackupModal,
  ] = useState(false);

  const [
    showSelectExportModal,
    setShowSelectExportModal,
  ] = useState(false);

  const [
    selectedIds,
    setSelectedIds,
  ] = useState<Set<string>>(
    new Set()
  );

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const filteredNotes =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return notesMeta;
      }

      return notesMeta.filter(
        (note) =>
          note.title
            .toLowerCase()
            .includes(query) ||
          (note.folder || "")
            .toLowerCase()
            .includes(query) ||
          note.tags.some(
            (tag) =>
              tag
                .toLowerCase()
                .includes(query)
          )
      );
    }, [
      notesMeta,
      search,
    ]);

  function showMessage(
    type:
      | "success"
      | "error",
    text: string
  ) {
    setMessage({
      type,
      text,
    });

    window.setTimeout(() => {
      setMessage(
        (current) =>
          current?.text ===
          text
            ? null
            : current
      );
    }, 3600);
  }

  function openSelectExport() {
    setSelectedIds(
      new Set()
    );

    setSearch("");

    setShowBackupModal(
      false
    );

    setShowSelectExportModal(
      true
    );
  }

  function toggleSelected(
    noteId: string
  ) {
    setSelectedIds(
      (previous) => {
        const next =
          new Set(
            previous
          );

        if (
          next.has(noteId)
        ) {
          next.delete(noteId);
        } else {
          next.add(noteId);
        }

        return next;
      }
    );
  }

  function selectAllVisible() {
    setSelectedIds(
      (previous) => {
        const next =
          new Set(
            previous
          );

        for (
          const note of
          filteredNotes
        ) {
          next.add(
            note.id
          );
        }

        return next;
      }
    );
  }

  function clearSelected() {
    setSelectedIds(
      new Set()
    );
  }

  async function handleExportVault() {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await exportVaultZip(
        "Markdown-Vault"
      );

      showMessage(
        "success",
        "已匯出完整 ZIP 備份"
      );
    } catch (error: any) {
      showMessage(
        "error",
        `匯出失敗：${
          error?.message ||
          error
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleExportSelected() {
    if (busy) {
      return;
    }

    const ids =
      Array.from(
        selectedIds
      );

    if (
      ids.length ===
      0
    ) {
      showMessage(
        "error",
        "請至少選取一篇筆記"
      );

      return;
    }

    setBusy(true);

    try {
      await exportSelectedNotesZip(
        ids,
        "Selected-Notes"
      );

      setShowSelectExportModal(
        false
      );

      showMessage(
        "success",
        `已匯出 ${ids.length} 篇筆記 ZIP`
      );
    } catch (error: any) {
      showMessage(
        "error",
        `匯出失敗：${
          error?.message ||
          error
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreVault(
    event:
      React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target
        .files?.[0];

    if (!file) {
      return;
    }

    event.target.value =
      "";

    const confirmed =
      window.confirm(
        "完整還原會刪除目前本機知識庫內容，並以這份 ZIP 備份中的筆記、資料夾與附件完整取代。\n\n如果你只是要加入別人分享的筆記，請取消並使用「匯入筆記」。\n\n確定要完整還原嗎？"
      );

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      revokeAllActiveMediaUrls();

      const isLegacyJson =
        file.name
          .toLowerCase()
          .endsWith(
            ".json"
          );

      const result =
        isLegacyJson
          ? await parseAndRestoreVaultBackup(
              await file.text()
            )
          : await restoreVaultZip(
              file
            );

      setShowBackupModal(
        false
      );

      await onDataChanged(
        result.notes[0]?.id
      );

      showMessage(
        "success",
        `已還原 ${result.notes.length} 篇筆記、${result.mediaCount} 個附件`
      );
    } catch (error: any) {
      showMessage(
        "error",
        `還原失敗：${
          error?.message ||
          "ZIP 格式不符"
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleImportNotes(
    event:
      React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target
        .files?.[0];

    if (!file) {
      return;
    }

    event.target.value =
      "";

    setBusy(true);

    try {
      const result =
        await importNotesZip(
          file
        );

      await onDataChanged(
        result.notes[0]?.id
      );

      const renameText =
        result.renamedCount >
        0
          ? `，其中 ${result.renamedCount} 篇因同名已自動重新命名`
          : "";

      showMessage(
        "success",
        `已新增 ${result.notes.length} 篇筆記、${result.mediaCount} 個附件${renameText}`
      );
    } catch (error: any) {
      showMessage(
        "error",
        `匯入筆記失敗：${
          error?.message ||
          "ZIP 格式不符"
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  function modalPortal(
    content:
      React.ReactNode
  ) {
    if (
      typeof document ===
      "undefined"
    ) {
      return null;
    }

    return createPortal(
      content,
      document.body
    );
  }

  return (
    <>
      <input
        ref={
          restoreInputRef
        }
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={(
          event
        ) =>
          void handleRestoreVault(
            event
          )
        }
      />

      <input
        ref={
          importNotesInputRef
        }
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(
          event
        ) =>
          void handleImportNotes(
            event
          )
        }
      />

      <div className="flex items-center justify-between gap-1 border-t border-white/5 bg-black/20 p-2 text-[11px] text-slate-500">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setShowBackupModal(
              true
            )
          }
          className="whitespace-nowrap px-2 py-1 hover:text-slate-200 disabled:opacity-40"
        >
          備份 / 還原
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            importNotesInputRef.current?.click()
          }
          className="whitespace-nowrap px-2 py-1 hover:text-cyan-200 disabled:opacity-40"
          title="加入 ZIP 內的筆記，不覆蓋目前知識庫"
        >
          匯入筆記
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={
            onToggleGraph
          }
          className={`whitespace-nowrap px-2 py-1 ${
            mainView ===
            "graph"
              ? "text-cyan-200"
              : "hover:text-slate-200"
          } disabled:opacity-40`}
        >
          圖譜視圖
        </button>
      </div>

      {message &&
        modalPortal(
          <div
            className={`fixed bottom-5 right-5 z-[14050] max-w-sm border px-3.5 py-2 text-xs shadow-2xl ${
              message.type ===
              "error"
                ? "border-red-500/20 bg-[#1a1111]/96 text-red-200"
                : "border-cyan-700/20 bg-[#121415]/96 text-slate-200"
            }`}
          >
            {message.text}
          </div>
        )}

      {showBackupModal &&
        modalPortal(
          <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="font-serif text-sm text-white">
                  本機知識庫備份與管理
                </h3>

                <button
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    setShowBackupModal(
                      false
                    )
                  }
                  className="text-slate-500 hover:text-white disabled:opacity-40"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 py-4 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>
                    目前筆記
                  </span>

                  <span className="font-mono">
                    {
                      notesMeta.length
                    }
                  </span>
                </div>

                <button
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    void handleExportVault()
                  }
                  className="w-full border border-cyan-700/30 py-2.5 text-cyan-200 hover:bg-cyan-950/20 disabled:opacity-40"
                >
                  匯出完整 ZIP 備份
                </button>

                <button
                  type="button"
                  disabled={
                    busy ||
                    notesMeta.length ===
                      0
                  }
                  onClick={
                    openSelectExport
                  }
                  className="w-full border border-white/10 py-2.5 text-slate-300 hover:bg-white/[0.03] disabled:opacity-40"
                >
                  選取筆記匯出 ZIP
                </button>

                <button
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    restoreInputRef.current?.click()
                  }
                  className="w-full border border-red-800/25 py-2.5 text-red-200/80 hover:bg-red-950/15 disabled:opacity-40"
                >
                  還原完整 ZIP 備份
                </button>

                <div className="space-y-1 border-t border-white/5 pt-3 text-[10px] leading-relaxed text-slate-600">
                  <p>
                    完整備份會包含所有筆記、資料夾及附件。
                  </p>

                  <p>
                    「還原完整備份」會完整取代目前資料。
                  </p>

                  <p>
                    如果要加入別人分享的部分筆記，請使用左下方「匯入筆記」，不會覆蓋現有內容。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

      {showSelectExportModal &&
        modalPortal(
          <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="flex max-h-[82vh] w-full max-w-lg flex-col border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <h3 className="font-serif text-sm text-white">
                    選取要匯出的筆記
                  </h3>

                  <p className="mt-1 text-[10px] text-slate-500">
                    已選取{" "}
                    {
                      selectedIds.size
                    }{" "}
                    篇
                  </p>
                </div>

                <button
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    setShowSelectExportModal(
                      false
                    )
                  }
                  className="text-slate-500 hover:text-white disabled:opacity-40"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={
                    search
                  }
                  onChange={(
                    event
                  ) =>
                    setSearch(
                      event
                        .target
                        .value
                    )
                  }
                  placeholder="搜尋筆記、資料夾或標籤..."
                  className="min-w-0 flex-1 border-b border-white/10 bg-transparent px-2 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-700/60"
                />

                <button
                  type="button"
                  onClick={
                    selectAllVisible
                  }
                  className="shrink-0 px-2 py-2 text-[10px] text-slate-400 hover:text-cyan-200"
                >
                  全選
                </button>

                <button
                  type="button"
                  onClick={
                    clearSelected
                  }
                  className="shrink-0 px-2 py-2 text-[10px] text-slate-400 hover:text-white"
                >
                  清除
                </button>
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto border border-white/5 p-2">
                {filteredNotes.length ===
                0 ? (
                  <div className="py-8 text-center text-xs text-slate-600">
                    找不到筆記
                  </div>
                ) : (
                  filteredNotes.map(
                    (
                      note
                    ) => {
                      const checked =
                        selectedIds.has(
                          note.id
                        );

                      return (
                        <label
                          key={
                            note.id
                          }
                          className={`mb-1 flex cursor-pointer items-start gap-3 border px-3 py-2.5 ${
                            checked
                              ? "border-cyan-700/25 bg-cyan-950/15"
                              : "border-transparent hover:bg-white/[0.025]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={
                              checked
                            }
                            onChange={() =>
                              toggleSelected(
                                note.id
                              )
                            }
                            className="mt-0.5"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs text-slate-200">
                              {
                                note.title
                              }
                            </div>

                            <div className="mt-1 truncate text-[10px] text-slate-600">
                              {
                                note.folder ||
                                "根目錄"
                              }
                            </div>
                          </div>
                        </label>
                      );
                    }
                  )
                )}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                <span className="text-[10px] text-slate-500">
                  只會包含所選筆記實際引用的附件
                </span>

                <button
                  type="button"
                  disabled={
                    busy ||
                    selectedIds.size ===
                      0
                  }
                  onClick={() =>
                    void handleExportSelected()
                  }
                  className="shrink-0 border border-cyan-700/35 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-950/20 disabled:opacity-40"
                >
                  匯出 ZIP
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
