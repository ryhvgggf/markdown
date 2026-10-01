"use client";

import { BacklinkItem, Note, NoteMetadata } from "@/lib/obsidian/types";

interface BacklinksPanelProps {
  activeNote: Note | null;
  backlinks: BacklinkItem[];
  allNotes?: Array<Note | NoteMetadata>;
  onSelectNote: (noteId: string) => void;
  onNavigateToNoteTitle?: (title: string) => void;
}

export function BacklinksPanel({
  activeNote,
  backlinks,
  allNotes = [],
  onSelectNote,
  onNavigateToNoteTitle,
}: BacklinksPanelProps) {
  if (!activeNote) return null;

  const existingTitlesSet = new Set(allNotes.map((n) => n.title.toLowerCase().trim()));
  const outlinks = activeNote.outlinks;

  return (
    <div className="flex h-full flex-col bg-[#121418] border-l border-white/6 text-slate-200 overflow-y-auto">
      {/* 標題列 */}
      <div className="p-3 border-b border-white/6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-serif">
          <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
          </svg>
          連結關係網絡
        </h3>
      </div>

      <div className="p-3 space-y-5">
        {/* 反向連結區塊 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>反向連結 (Backlinks)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-mono">
                {backlinks.length}
              </span>
            </span>
          </div>

          {backlinks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/8 bg-transparent p-3 text-center text-xs text-slate-500">
              尚無其他筆記引用此篇
            </div>
          ) : (
            <div className="space-y-2">
              {backlinks.map((link) => (
                <div
                  key={link.sourceNoteId}
                  onClick={() => onSelectNote(link.sourceNoteId)}
                  className="group rounded-lg border border-white/6 bg-[#16181f] p-2.5 transition-colors hover:border-white/15 hover:bg-white/2 rounded-lg hover:bg-slate-950 cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300 group-hover:text-cyan-200">
                    <svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>{link.sourceNoteTitle}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400 group-hover:text-slate-300 line-clamp-2">
                    {link.contextSnippet}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 出向連結區塊 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>出向連結 (Outgoing Links)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-mono">
                {outlinks.length}
              </span>
            </span>
          </div>

          {outlinks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/8 bg-transparent p-3 text-center text-xs text-slate-500">
              本文未包含任何 [[雙向連結]]
            </div>
          ) : (
            <div className="space-y-1.5">
              {outlinks.map((targetTitle) => {
                const exists = existingTitlesSet.has(targetTitle.toLowerCase().trim());
                return (
                  <button
                    key={targetTitle}
                    onClick={() => onNavigateToNoteTitle && onNavigateToNoteTitle(targetTitle)}
                    className="w-full flex items-center justify-between rounded-md border border-slate-800/80 bg-slate-950/40 px-2.5 py-1.5 text-xs text-left transition hover:bg-slate-800 hover:border-slate-700 cursor-pointer"
                  >
                    <span className="text-slate-200 truncate pr-2">{targetTitle}</span>
                    {exists ? (
                      <span className="text-[10px] text-cyan-400 font-medium flex-shrink-0">已連結</span>
                    ) : (
                      <span className="text-[10px] text-amber-500 font-medium flex-shrink-0">未建立</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
