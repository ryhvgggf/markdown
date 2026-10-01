"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { NoteMetadata, ViewMode } from "@/lib/obsidian/types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  notes: NoteMetadata[];
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onOpenGraph: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSelectTag?: (tag: string) => void;
  allTags?: string[];
}

interface PaletteItem {
  id: string;
  category: "筆記" | "指令" | "標籤";
  title: string;
  subtitle?: string;
  action: () => void;
  icon: string;
}

export function CommandPalette({
  isOpen,
  onClose,
  notes,
  onSelectNote,
  onCreateNote,
  onOpenGraph,
  onSetViewMode,
  onSelectTag,
  allTags = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const items = useMemo(() => {
    const q = query.toLowerCase().trim();
    const result: PaletteItem[] = [];

    // 1. 系統指令
    const commands: PaletteItem[] = [
      {
        id: "cmd-new-note",
        category: "指令",
        title: "建立新筆記",
        subtitle: "在知識庫中起稿一篇新文章",
        icon: "＋",
        action: () => {
          onCreateNote();
          onClose();
        },
      },
      {
        id: "cmd-open-graph",
        category: "指令",
        title: "開啟知識圖譜 (Graph View)",
        subtitle: "水墨散點關係網絡",
        icon: "◎",
        action: () => {
          onOpenGraph();
          onClose();
        },
      },
      {
        id: "cmd-mode-edit",
        category: "指令",
        title: "切換檢視：純編輯模式",
        subtitle: "專注內文輸入",
        icon: "✎",
        action: () => {
          onSetViewMode("edit");
          onClose();
        },
      },
      {
        id: "cmd-mode-split",
        category: "指令",
        title: "切換檢視：雙欄對照模式",
        subtitle: "同時檢視 Markdown 與預覽",
        icon: "◫",
        action: () => {
          onSetViewMode("split");
          onClose();
        },
      },
      {
        id: "cmd-mode-preview",
        category: "指令",
        title: "切換檢視：閱讀預覽模式",
        subtitle: "乾淨留白排版",
        icon: "目",
        action: () => {
          onSetViewMode("preview");
          onClose();
        },
      },
    ];

    // 2. 筆記過濾
    const matchedNotes = notes
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.folder && n.folder.toLowerCase().includes(q)))
      .slice(0, 8)
      .map((n) => ({
        id: `note-${n.id}`,
        category: "筆記" as const,
        title: n.title,
        subtitle: n.folder ? `分類：${n.folder}` : "根目錄",
        icon: "📄",
        action: () => {
          onSelectNote(n.id);
          onClose();
        },
      }));

    // 3. 標籤過濾
    const matchedTags = allTags
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 5)
      .map((t) => ({
        id: `tag-${t}`,
        category: "標籤" as const,
        title: `#${t}`,
        subtitle: "依金石印籤篩選筆記",
        icon: "印",
        action: () => {
          onSelectTag?.(t);
          onClose();
        },
      }));

    if (!q) {
      result.push(...commands.slice(0, 2), ...matchedNotes, ...commands.slice(2));
    } else {
      const filteredCommands = commands.filter(
        (c) => c.title.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q)
      );
      result.push(...filteredCommands, ...matchedNotes, ...matchedTags);
    }

    return result;
  }, [query, notes, allTags, onCreateNote, onOpenGraph, onSetViewMode, onSelectNote, onSelectTag, onClose]);

  // 鍵盤導航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].action();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/55 backdrop-blur-xs transition-opacity duration-150 animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl mx-4 rounded-xl bg-[#14171d]/95 border border-white/10 shadow-2xl overflow-hidden backdrop-blur-md flex flex-col text-slate-200 ring-1 ring-white/5"
      >
        {/* 輸入欄位 */}
        <div className="flex items-center px-4 py-3 border-b border-white/8 gap-3">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="尋篇訪墨：搜尋筆記、操作指令或標籤... (ESC 關閉)"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white/5 rounded border border-white/10">
            ESC
          </kbd>
        </div>

        {/* 搜尋項目列表 */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              無相符的筆記或指令
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors duration-100 cursor-pointer ${
                    isSelected
                      ? "bg-cyan-950/50 text-cyan-100 border-l-2 border-cyan-500"
                      : "text-slate-300 hover:bg-white/4"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 text-center text-xs opacity-70 shrink-0 font-mono text-cyan-400">
                      {item.icon}
                    </span>
                    <div className="truncate">
                      <div className="font-medium truncate">{item.title}</div>
                      {item.subtitle && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-400 shrink-0 ml-2">
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* 底部導覽捷徑說明 */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-black/20 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ 導覽</span>
            <span>↵ 執行</span>
          </div>
          <span>墨境指令面板 · Ctrl + K</span>
        </div>
      </div>
    </div>
  );
}
