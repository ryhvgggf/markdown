"use client";

import type { Note, NoteMetadata } from "@/lib/obsidian/types";
import {
  getDirectGraphChildren,
  hasGraphChildLink,
  hasGraphNoteLink,
  isGraphFolderVisible,
  normalizeGraphFolderPath,
  setGraphFolderChildLink,
  setGraphFolderNoteLink,
  setGraphFolderVisible,
  type FolderGraphSettings,
} from "@/lib/obsidian/folderGraph";

interface Props {
  folder: string;
  notes: Array<Note | NoteMetadata>;
  paths: string[];
  settings: FolderGraphSettings;
}

/** 左側資料夾及圖譜設定共用同一組選項。 */
export function FolderGraphControls({ folder, notes, paths, settings }: Props) {
  const path = normalizeGraphFolderPath(folder);
  const directNotes = notes.filter((note) => normalizeGraphFolderPath(note.folder || "") === path)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant", { numeric: true }));
  const children = getDirectGraphChildren(path, paths);
  const visible = isGraphFolderVisible(settings, path);
  const selectedNotes = directNotes.filter((note) => hasGraphNoteLink(settings, path, note.id)).length;
  const selectedChildren = children.filter((child) => hasGraphChildLink(settings, path, child)).length;

  return (
    <div className="space-y-3 text-xs text-slate-300" onClick={(event) => event.stopPropagation()}>
      <div className="border-b border-white/10 pb-2">
        <div className="break-all font-medium text-[#e4c698]">📁 {path}</div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          僅控制圖譜線條，不更動筆記內容與資料夾位置。所有新關聯預設關閉。
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 border border-white/10 bg-white/[0.025] px-2.5 py-2">
        <input type="checkbox" className="accent-[#b99767]" checked={visible}
          onChange={(event) => setGraphFolderVisible(path, event.target.checked, notes)} />
        <span className="flex-1">在圖譜顯示此資料夾節點</span>
      </label>
      <div>
        <strong className="text-[11px] text-[#d3c8b5]">直屬筆記 ({selectedNotes}/{directNotes.length})</strong>
        <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
          {directNotes.length ? directNotes.map((note) => (
            <label key={note.id} className="flex cursor-pointer items-start gap-2 px-1.5 py-1.5 hover:bg-white/[0.04]">
              <input type="checkbox" className="mt-0.5 accent-[#b99767]"
                checked={hasGraphNoteLink(settings, path, note.id)}
                onChange={(event) => setGraphFolderNoteLink(path, note.id, event.target.checked, notes)} />
              <span className="min-w-0 flex-1 break-words">{note.title}</span>
            </label>
          )) : <p className="px-1 text-[10px] text-slate-500">沒有直屬筆記</p>}
        </div>
      </div>
      <div>
        <strong className="text-[11px] text-[#d3c8b5]">直屬子資料夾 ({selectedChildren}/{children.length})</strong>
        <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
          {children.length ? children.map((child) => (
            <label key={child} className="flex cursor-pointer items-start gap-2 px-1.5 py-1.5 hover:bg-white/[0.04]">
              <input type="checkbox" className="mt-0.5 accent-[#b99767]"
                checked={hasGraphChildLink(settings, path, child)}
                onChange={(event) => setGraphFolderChildLink(path, child, event.target.checked, notes)} />
              <span className="min-w-0 flex-1 break-words">📁 {child.split("/").pop()}</span>
            </label>
          )) : <p className="px-1 text-[10px] text-slate-500">沒有直屬子資料夾</p>}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          子資料夾中的筆記只能選擇連向該子資料夾，不會直接連向此層。
        </p>
      </div>
    </div>
  );
}
