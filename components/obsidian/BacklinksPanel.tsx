"use client";

import {
  BacklinkItem,
  Note,
  NoteMetadata,
} from "@/lib/obsidian/types";

interface BacklinksPanelProps {
  activeNote: Note | null;
  backlinks: BacklinkItem[];
  allNotes?: Array<
    Note | NoteMetadata
  >;
  onSelectNote: (
    noteId: string
  ) => void;
  onNavigateToNoteTitle?: (
    title: string
  ) => void;
}

function formatDate(
  iso: string
): string {
  if (!iso) {
    return "-";
  }

  const date =
    new Date(iso);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "-";
  }

  return date.toLocaleString(
    "zh-TW",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

export function BacklinksPanel({
  activeNote,
  backlinks,
  allNotes = [],
  onSelectNote,
  onNavigateToNoteTitle,
}: BacklinksPanelProps) {
  if (!activeNote) {
    return null;
  }

  const existingTitlesSet =
    new Set(
      allNotes.map(
        (note) =>
          note.title
            .toLowerCase()
            .trim()
      )
    );

  const outlinks =
    activeNote.outlinks || [];

  const charCount =
    activeNote.content.length;

  const mediaMatches =
    activeNote.content.match(
      /!\[\[[^\]]+\]\]/g
    );

  const mediaCount =
    mediaMatches
      ? mediaMatches.length
      : 0;

  return (
    <div className="text-[#cac8c1]">
      {/* =========================
          反向連結
         ========================= */}
      <section className="ink-side-section">
        <div className="ink-section-title">
          <span>
            反向連結
          </span>

          <span className="ink-count">
            {backlinks.length}
          </span>
        </div>

        {backlinks.length ===
        0 ? (
          <p className="text-[11px] leading-relaxed text-[#666b67]">
            尚無其他筆記引用此篇。
          </p>
        ) : (
          <div className="space-y-1">
            {backlinks.map(
              (link) => (
                <button
                  key={
                    link.sourceNoteId
                  }
                  type="button"
                  onClick={() =>
                    onSelectNote(
                      link.sourceNoteId
                    )
                  }
                  className="ink-link-row group"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-[2px] text-[#718f8a] text-xs">
                      ▫
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-[12px] text-[#d7d3ca] group-hover:text-[#eeeae1]">
                        {
                          link.sourceNoteTitle
                        }
                      </div>

                      {link.contextSnippet && (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#747873]">
                          {
                            link.contextSnippet
                          }
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            )}
          </div>
        )}
      </section>

      {/* =========================
          出向連結
         ========================= */}
      <section className="ink-side-section">
        <div className="ink-section-title">
          <span>
            出向連結
          </span>

          <span className="ink-count">
            {outlinks.length}
          </span>
        </div>

        {outlinks.length ===
        0 ? (
          <p className="text-[11px] leading-relaxed text-[#666b67]">
            本文尚未建立雙向連結。
          </p>
        ) : (
          <div className="space-y-1">
            {outlinks.map(
              (targetTitle) => {
                const exists =
                  existingTitlesSet.has(
                    targetTitle
                      .toLowerCase()
                      .trim()
                  );

                return (
                  <button
                    key={
                      targetTitle
                    }
                    type="button"
                    onClick={() =>
                      onNavigateToNoteTitle?.(
                        targetTitle
                      )
                    }
                    className="ink-link-row group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-serif text-[12px] text-[#d0cdc5] group-hover:text-[#eeeae1]">
                        {
                          targetTitle
                        }
                      </span>

                      <span
                        className={`flex-shrink-0 text-[9px] ${
                          exists
                            ? "text-[#718f8a]"
                            : "text-[#98785f]"
                        }`}
                      >
                        {exists
                          ? "已連結"
                          : "未建立"}
                      </span>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        )}
      </section>

      {/* =========================
          筆記資訊
         ========================= */}
      <section>
        <div className="ink-section-title">
          <span>
            筆記資訊
          </span>
        </div>

        <div className="space-y-2 text-[10px] text-[#7f837e]">
          <div className="flex items-start justify-between gap-4">
            <span>
              建立時間
            </span>

            <span className="text-right font-mono text-[#aaa9a3]">
              {formatDate(
                activeNote.createdAt
              )}
            </span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <span>
              最後修改
            </span>

            <span className="text-right font-mono text-[#aaa9a3]">
              {formatDate(
                activeNote.updatedAt
              )}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span>
              字數
            </span>

            <span className="font-mono text-[#aaa9a3]">
              {charCount}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span>
              連結數
            </span>

            <span className="font-mono text-[#aaa9a3]">
              {
                outlinks.length +
                backlinks.length
              }
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span>
              附件數
            </span>

            <span className="font-mono text-[#aaa9a3]">
              {mediaCount}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
