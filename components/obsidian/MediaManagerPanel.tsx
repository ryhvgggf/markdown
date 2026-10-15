"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { createPortal } from "react-dom";

import {
  getAllMediaAttachments,
  getAllNotesFromDB,
} from "@/lib/obsidian/db";

import {
  deleteSavedMedia,
  isAudioType,
  isImageType,
  isVideoType,
} from "@/lib/obsidian/media";

import {
  extractMediaReferences,
} from "@/lib/obsidian/parser";

import {
  MediaAttachment,
  Note,
} from "@/lib/obsidian/types";

interface MediaManagerPanelProps {
  note: Note;
  disabled?: boolean;
  onUpdateContent: (content: string) => void;
}

type MediaUsage = {
  attachment: MediaAttachment;
  noteIds: string[];
  noteTitles: string[];
};

function escapeRegExp(text: string): string {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function formatBytes(size: number): string {
  if (
    !Number.isFinite(size) ||
    size <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
  ];

  const index =
    Math.min(
      Math.floor(
        Math.log(size) /
          Math.log(1024)
      ),
      units.length - 1
    );

  const value =
    size /
    Math.pow(1024, index);

  return `${
    value >= 10 ||
    index === 0
      ? value.toFixed(0)
      : value.toFixed(1)
  } ${units[index]}`;
}

function safeMediaLabel(
  filename: string
): string {
  return filename
    .replace(/\|/g, "／")
    .replace(/\]/g, "）");
}

function removeAttachmentReference(
  content: string,
  attachment: MediaAttachment
): string {
  let result =
    content;

  const refs =
    Array.from(
      new Set(
        [
          attachment.id,
          attachment.filename,
        ].filter(Boolean)
      )
    );

  for (
    const ref of
    refs
  ) {
    const escaped =
      escapeRegExp(ref);

    const regex =
      new RegExp(
        `!?\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]\\s*`,
        "g"
      );

    result =
      result.replace(
        regex,
        ""
      );
  }

  return result;
}

export function MediaManagerPanel({
  note,
  disabled = false,
  onUpdateContent,
}: MediaManagerPanelProps) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    items,
    setItems,
  ] = useState<MediaUsage[]>([]);

  const [
    tab,
    setTab,
  ] = useState<
    "current" |
    "unused" |
    "all"
  >("current");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState<
    string | null
  >(null);

  const [
    preview,
    setPreview,
  ] = useState<
    MediaAttachment | null
  >(null);

  const [
    previewUrl,
    setPreviewUrl,
  ] = useState<
    string | null
  >(null);

  async function refreshLibrary(
    waitForAutoSave = false
  ) {
    setLoading(true);

    try {
      if (
        waitForAutoSave
      ) {
        await new Promise(
          (resolve) => {
            window.setTimeout(
              resolve,
              420
            );
          }
        );
      }

      const [
        media,
        notes,
      ] =
        await Promise.all([
          getAllMediaAttachments(),
          getAllNotesFromDB(),
        ]);

      const mediaById =
        new Map(
          media.map(
            (item) => [
              item.id,
              item,
            ]
          )
        );

      const mediaByFilename =
        new Map<
          string,
          MediaAttachment[]
        >();

      for (
        const item of
        media
      ) {
        const list =
          mediaByFilename.get(
            item.filename
          ) || [];

        list.push(item);

        mediaByFilename.set(
          item.filename,
          list
        );
      }

      const usageMap =
        new Map<
          string,
          Set<string>
        >();

      const titleMap =
        new Map(
          notes.map(
            (item) => [
              item.id,
              item.title,
            ]
          )
        );

      for (
        const currentNote of
        notes
      ) {
        const refs =
          extractMediaReferences(
            currentNote.content
          );

        for (
          const ref of
          refs
        ) {
          let target =
            mediaById.get(
              ref
            );

          if (!target) {
            const matches =
              mediaByFilename.get(
                ref
              ) || [];

            if (
              matches.length ===
              1
            ) {
              target =
                matches[0];
            }
          }

          if (!target) {
            continue;
          }

          const usedBy =
            usageMap.get(
              target.id
            ) ||
            new Set<string>();

          usedBy.add(
            currentNote.id
          );

          usageMap.set(
            target.id,
            usedBy
          );
        }
      }

      const next =
        media
          .map(
            (
              attachment
            ) => {
              const noteIds =
                Array.from(
                  usageMap.get(
                    attachment.id
                  ) || []
                );

              return {
                attachment,
                noteIds,
                noteTitles:
                  noteIds
                    .map(
                      (id) =>
                        titleMap.get(
                          id
                        ) ||
                        id
                    )
                    .sort(
                      (
                        a,
                        b
                      ) =>
                        a.localeCompare(
                          b
                        )
                    ),
              };
            }
          )
          .sort(
            (
              a,
              b
            ) =>
              b.attachment
                .createdAt
                .localeCompare(
                  a.attachment
                    .createdAt
                )
          );

      setItems(next);
    } catch (
      error: any
    ) {
      setMessage(
        `讀取附件失敗：${
          error?.message ||
          error
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  function openManager() {
    setOpen(true);
    setTab("current");
    setSearch("");
    setMessage(null);

    void refreshLibrary(
      true
    );
  }

  useEffect(() => {
    if (!preview) {
      setPreviewUrl(
        null
      );

      return;
    }

    const url =
      URL.createObjectURL(
        preview.blob
      );

    setPreviewUrl(
      url
    );

    return () => {
      URL.revokeObjectURL(
        url
      );
    };
  }, [preview]);

  const currentItems =
    useMemo(
      () =>
        items.filter(
          (item) =>
            item.noteIds.includes(
              note.id
            )
        ),
      [
        items,
        note.id,
      ]
    );

  const unusedItems =
    useMemo(
      () =>
        items.filter(
          (item) =>
            item.noteIds.length ===
            0
        ),
      [items]
    );

  const filteredItems =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      let source =
        items;

      if (
        tab ===
        "current"
      ) {
        source =
          currentItems;
      } else if (
        tab ===
        "unused"
      ) {
        source =
          unusedItems;
      }

      if (!query) {
        return source;
      }

      return source.filter(
        (item) =>
          item.attachment
            .filename
            .toLowerCase()
            .includes(
              query
            ) ||
          item.attachment
            .id
            .toLowerCase()
            .includes(
              query
            ) ||
          item.noteTitles
            .some(
              (title) =>
                title
                  .toLowerCase()
                  .includes(
                    query
                  )
            )
      );
    }, [
      items,
      currentItems,
      unusedItems,
      tab,
      search,
    ]);

  const totalSize =
    useMemo(
      () =>
        items.reduce(
          (
            sum,
            item
          ) =>
            sum +
            (
              item.attachment
                .size ||
              0
            ),
          0
        ),
      [items]
    );

  const unusedSize =
    useMemo(
      () =>
        unusedItems.reduce(
          (
            sum,
            item
          ) =>
            sum +
            (
              item.attachment
                .size ||
              0
            ),
          0
        ),
      [unusedItems]
    );

  function downloadAttachment(
    attachment:
      MediaAttachment
  ) {
    const url =
      URL.createObjectURL(
        attachment.blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

    anchor.download =
      attachment.filename;

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    window.setTimeout(
      () => {
        URL.revokeObjectURL(
          url
        );
      },
      1000
    );
  }

  async function removeFromCurrentNote(
    attachment:
      MediaAttachment
  ) {
    const nextContent =
      removeAttachmentReference(
        note.content,
        attachment
      );

    if (
      nextContent ===
      note.content
    ) {
      setMessage(
        "目前筆記中找不到這個附件引用"
      );

      return;
    }

    onUpdateContent(
      nextContent
    );

    setMessage(
      `已從目前筆記移除 ${attachment.filename} 的引用；實體附件仍保留`
    );

    await refreshLibrary(
      true
    );
  }

  async function reinsertToCurrentNote(
    attachment:
      MediaAttachment
  ) {
    const label =
      safeMediaLabel(
        attachment.filename
      );

    const reference =
      `![[${attachment.id}|${label}]]`;

    const spacer =
      note.content.endsWith(
        "\n"
      )
        ? ""
        : "\n";

    const nextContent =
      `${note.content}${spacer}\n${reference}\n`;

    onUpdateContent(
      nextContent
    );

    setMessage(
      `已重新插入 ${attachment.filename}`
    );

    await refreshLibrary(
      true
    );
  }

  async function deleteUnusedAttachment(
    item: MediaUsage
  ) {
    if (
      item.noteIds.length >
      0
    ) {
      setMessage(
        "此附件仍被筆記使用，請先移除引用後再永久刪除"
      );

      return;
    }

    const confirmed =
      window.confirm(
        `確定要永久刪除「${item.attachment.filename}」嗎？\n\n此附件目前沒有任何筆記引用，刪除後無法復原。`
      );

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      await deleteSavedMedia(
        item.attachment.id
      );

      setPreview(
        null
      );

      setMessage(
        `已永久刪除 ${item.attachment.filename}`
      );

      await refreshLibrary();
    } catch (
      error: any
    ) {
      setMessage(
        `刪除失敗：${
          error?.message ||
          error
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function cleanupUnused() {
    if (
      unusedItems.length ===
      0
    ) {
      setMessage(
        "目前沒有未使用附件"
      );

      return;
    }

    const confirmed =
      window.confirm(
        `確定要清理 ${unusedItems.length} 個未使用附件嗎？\n\n預計釋放約 ${formatBytes(unusedSize)}。\n\n此動作無法復原。`
      );

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      for (
        const item of
        unusedItems
      ) {
        await deleteSavedMedia(
          item.attachment.id
        );
      }

      setPreview(
        null
      );

      setMessage(
        `已清理 ${unusedItems.length} 個未使用附件，釋放約 ${formatBytes(unusedSize)}`
      );

      await refreshLibrary();
    } catch (
      error: any
    ) {
      setMessage(
        `清理失敗：${
          error?.message ||
          error
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  function renderPreview() {
    if (
      !preview ||
      !previewUrl
    ) {
      return null;
    }

    const source =
      preview.mimeType ||
      preview.filename;

    if (
      isImageType(
        source
      )
    ) {
      return (
        <img
          src={
            previewUrl
          }
          alt={
            preview.filename
          }
          className="max-h-[55vh] max-w-full object-contain"
        />
      );
    }

    if (
      isVideoType(
        source
      )
    ) {
      return (
        <video
          src={
            previewUrl
          }
          controls
          className="max-h-[55vh] max-w-full"
        />
      );
    }

    if (
      isAudioType(
        source
      )
    ) {
      return (
        <audio
          src={
            previewUrl
          }
          controls
          className="w-full max-w-md"
        />
      );
    }

    return (
      <div className="text-center text-xs text-slate-400">
        此檔案沒有內建預覽，可使用「下載」查看。
      </div>
    );
  }

  if (
    typeof document ===
    "undefined"
  ) {
    return (
      <button
        type="button"
        disabled
        className="px-2 py-1 text-xs text-slate-600"
      >
        附件管理
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={
          disabled
        }
        onClick={
          openManager
        }
        className="px-2 py-1 text-xs text-slate-400 hover:text-cyan-200 disabled:opacity-40"
        title="管理本機附件與未使用檔案"
      >
        附件管理
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[14500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="flex max-h-[88vh] w-full max-w-4xl flex-col border border-white/10 bg-[#101315] text-slate-200 shadow-2xl">

              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <h3 className="font-serif text-base text-white">
                    附件管理
                  </h3>

                  <p className="mt-1 text-[10px] text-slate-500">
                    全部 {items.length} 個 · {formatBytes(totalSize)}
                    {" · "}
                    未使用 {unusedItems.length} 個 · {formatBytes(unusedSize)}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() => {
                    setOpen(
                      false
                    );

                    setPreview(
                      null
                    );
                  }}
                  className="text-slate-500 hover:text-white disabled:opacity-40"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-5 py-3 text-xs">

                <button
                  type="button"
                  onClick={() =>
                    setTab(
                      "current"
                    )
                  }
                  className={`border px-3 py-1.5 ${
                    tab ===
                    "current"
                      ? "border-cyan-700/40 text-cyan-200"
                      : "border-white/10 text-slate-400"
                  }`}
                >
                  本篇附件 ({currentItems.length})
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setTab(
                      "unused"
                    )
                  }
                  className={`border px-3 py-1.5 ${
                    tab ===
                    "unused"
                      ? "border-cyan-700/40 text-cyan-200"
                      : "border-white/10 text-slate-400"
                  }`}
                >
                  未使用附件 ({unusedItems.length})
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setTab(
                      "all"
                    )
                  }
                  className={`border px-3 py-1.5 ${
                    tab ===
                    "all"
                      ? "border-cyan-700/40 text-cyan-200"
                      : "border-white/10 text-slate-400"
                  }`}
                >
                  全部附件 ({items.length})
                </button>

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
                  placeholder="搜尋檔名或筆記..."
                  className="ml-auto min-w-48 border-b border-white/10 bg-transparent px-2 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-700/60"
                />

                <button
                  type="button"
                  disabled={
                    busy ||
                    unusedItems.length ===
                      0
                  }
                  onClick={() =>
                    void cleanupUnused()
                  }
                  className="border border-red-800/30 px-3 py-1.5 text-red-300/80 hover:bg-red-950/20 disabled:opacity-40"
                >
                  清理未使用附件
                </button>
              </div>

              {message && (
                <div className="border-b border-white/5 bg-white/[0.02] px-5 py-2 text-xs text-slate-300">
                  {
                    message
                  }
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto p-4">

                {loading ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    正在掃描附件與筆記引用…
                  </div>
                ) : filteredItems.length ===
                  0 ? (
                  <div className="py-12 text-center text-xs text-slate-600">
                    {tab ===
                    "current"
                      ? "目前這篇筆記沒有附件"
                      : tab ===
                        "unused"
                      ? "目前沒有未使用附件"
                      : "找不到附件"}
                  </div>
                ) : (
                  <div className="space-y-2">

                    {filteredItems.map(
                      (
                        item
                      ) => {
                        const attachment =
                          item.attachment;

                        const unused =
                          item.noteIds.length ===
                          0;

                        const usedByCurrent =
                          item.noteIds.includes(
                            note.id
                          );

                        return (
                          <div
                            key={
                              attachment.id
                            }
                            className="flex flex-col gap-3 border border-white/10 bg-black/10 p-3 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0 flex-1">

                              <div className="truncate text-xs text-slate-200">
                                {
                                  attachment.filename
                                }
                              </div>

                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
                                <span>
                                  {
                                    formatBytes(
                                      attachment.size
                                    )
                                  }
                                </span>

                                <span>
                                  {
                                    attachment.mimeType ||
                                    "未知類型"
                                  }
                                </span>

                                <span
                                  className={
                                    unused
                                      ? "text-amber-300/80"
                                      : "text-slate-500"
                                  }
                                >
                                  {unused
                                    ? "未被任何筆記使用"
                                    : `使用於 ${item.noteIds.length} 篇筆記`}
                                </span>
                              </div>

                              {!unused &&
                                item.noteTitles.length >
                                  0 && (
                                  <div className="mt-1 truncate text-[10px] text-slate-600">
                                    {
                                      item.noteTitles.join(
                                        "、"
                                      )
                                    }
                                  </div>
                                )}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px]">

                              <button
                                type="button"
                                onClick={() =>
                                  setPreview(
                                    attachment
                                  )
                                }
                                className="border border-white/10 px-2.5 py-1.5 text-slate-300 hover:text-white"
                              >
                                預覽
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  downloadAttachment(
                                    attachment
                                  )
                                }
                                className="border border-white/10 px-2.5 py-1.5 text-slate-300 hover:text-white"
                              >
                                下載
                              </button>

                              {usedByCurrent && (
                                <button
                                  type="button"
                                  disabled={
                                    busy
                                  }
                                  onClick={() =>
                                    void removeFromCurrentNote(
                                      attachment
                                    )
                                  }
                                  className="border border-amber-700/30 px-2.5 py-1.5 text-amber-200/90 disabled:opacity-40"
                                >
                                  移除本篇引用
                                </button>
                              )}

                              {unused && (
                                <>
                                  <button
                                    type="button"
                                    disabled={
                                      busy
                                    }
                                    onClick={() =>
                                      void reinsertToCurrentNote(
                                        attachment
                                      )
                                    }
                                    className="border border-cyan-700/35 px-2.5 py-1.5 text-cyan-200 disabled:opacity-40"
                                  >
                                    重新插入本篇
                                  </button>

                                  <button
                                    type="button"
                                    disabled={
                                      busy
                                    }
                                    onClick={() =>
                                      void deleteUnusedAttachment(
                                        item
                                      )
                                    }
                                    className="border border-red-800/30 px-2.5 py-1.5 text-red-300/80 hover:bg-red-950/20 disabled:opacity-40"
                                  >
                                    永久刪除
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {preview &&
        createPortal(
          <div className="fixed inset-0 z-[14600] flex items-center justify-center bg-black/85 p-4">
            <div className="w-full max-w-2xl border border-white/10 bg-[#111416] p-4 shadow-2xl">

              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs text-slate-200">
                    {
                      preview.filename
                    }
                  </div>

                  <div className="mt-1 text-[10px] text-slate-600">
                    {
                      formatBytes(
                        preview.size
                      )
                    }
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPreview(
                      null
                    )
                  }
                  className="text-slate-500 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="flex min-h-40 items-center justify-center border border-white/5 bg-black/30 p-4">
                {
                  renderPreview()
                }
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    downloadAttachment(
                      preview
                    )
                  }
                  className="border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                >
                  下載
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
