"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { NoteMetadata, FolderNode } from "@/lib/obsidian/types";
import { getCustomFolders, saveCustomFolders } from "@/lib/obsidian/db";

interface FileTreeProps {
  notes: NoteMetadata[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (initialTitle?: string, folder?: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (id: string, newTitle: string) => void;
  onMoveNoteFolder?: (noteId: string, targetFolder: string) => void;
  onMoveFolder?: (sourceFolder: string, targetParent: string) => void;
  selectedTag: string | null;
  onClearTagFilter: () => void;
}

interface DragItemData {
  type: "note" | "folder";
  id?: string;
  path?: string;
  title?: string;
  name?: string;
}

export default function FileTree({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onRenameNote,
  onMoveNoteFolder,
  onMoveFolder,
  selectedTag,
  onClearTagFilter,
}: FileTreeProps) {
  const [search, setSearch] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [nameError, setNameError] = useState("");

  // 自訂建立的資料夾列表
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  // 展開的資料夾路徑 Set
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 雙軌拖曳引擎狀態
  const [isDragging, setIsDragging] = useState(false);
  const [activeDragItem, setActiveDragItem] = useState<DragItemData | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const pointerStartRef = useRef<{ x: number; y: number; item: DragItemData } | null>(null);
  const dragItemRef = useRef<DragItemData | null>(null);
  const dragOverPathRef = useRef<string | null>(null);
  const hoverExpandTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 建立資料夾狀態
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [targetParentFolder, setTargetParentFolder] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState("");

  // 重新命名資料夾狀態
  const [renamingFolder, setRenamingFolder] = useState<{ oldPath: string; newName: string } | null>(null);

  // 刪除資料夾狀態
  const [deletingFolder, setDeletingFolder] = useState<{ path: string; count: number } | null>(null);

  // 刪除筆記狀態
  const [deletingNote, setDeletingNote] = useState<{ id: string; title: string } | null>(null);

  // 初始化自本機讀取資料夾與展開狀態
  useEffect(() => {
    const folders = getCustomFolders();
    setCustomFolders(folders);

    const initialExpanded = new Set<string>(folders);
    notes.forEach((n) => {
      if (n.folder) {
        initialExpanded.add(n.folder);
        const parts = n.folder.split("/");
        let acc = "";
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          initialExpanded.add(acc);
        }
      }
    });
    setExpandedFolders(initialExpanded);
  }, [notes]);

  // 切換資料夾展開/收合
  const toggleFolder = (folderPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  // 建立新資料夾
  const handleCreateFolder = () => {
    const trimmed = newFolderName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) {
      setFolderError("資料夾名稱不能為空");
      return;
    }
    if (trimmed.includes("/")) {
      setFolderError("子資料夾名稱請勿包含斜線「/」");
      return;
    }

    const fullPath = targetParentFolder ? `${targetParentFolder}/${trimmed}` : trimmed;
    if (customFolders.includes(fullPath) || notes.some((n) => n.folder === fullPath)) {
      setFolderError("已存在同名資料夾");
      return;
    }

    const nextFolders = [...customFolders, fullPath];
    setCustomFolders(nextFolders);
    saveCustomFolders(nextFolders);

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(fullPath);
      if (targetParentFolder) {
        const parts = targetParentFolder.split("/");
        let acc = "";
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          next.add(acc);
        }
      }
      return next;
    });

    setShowCreateFolderModal(false);
    setNewFolderName("");
    setTargetParentFolder("");
    setFolderError("");
  };

  // 重新命名資料夾
  const handleRenameFolder = () => {
    if (!renamingFolder) return;
    const trimmed = renamingFolder.newName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;

    const oldPath = renamingFolder.oldPath;
    const parent = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
    const newPath = parent ? `${parent}/${trimmed}` : trimmed;

    if (oldPath === newPath) {
      setRenamingFolder(null);
      return;
    }

    const nextCustom = customFolders.map((f) => {
      if (f === oldPath) return newPath;
      if (f.startsWith(oldPath + "/")) return newPath + f.slice(oldPath.length);
      return f;
    });
    setCustomFolders(nextCustom);
    saveCustomFolders(nextCustom);

    if (onMoveNoteFolder) {
      notes.forEach((n) => {
        if (n.folder === oldPath) {
          onMoveNoteFolder(n.id, newPath);
        } else if (n.folder?.startsWith(oldPath + "/")) {
          onMoveNoteFolder(n.id, newPath + n.folder.slice(oldPath.length));
        }
      });
    }

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(oldPath)) {
        next.delete(oldPath);
        next.add(newPath);
      }
      return next;
    });

    setRenamingFolder(null);
  };

  // 確認刪除資料夾
  const handleConfirmDeleteFolder = () => {
    if (!deletingFolder) return;
    const targetPath = deletingFolder.path;

    if (onMoveNoteFolder) {
      notes.forEach((n) => {
        if (n.folder === targetPath || n.folder?.startsWith(targetPath + "/")) {
          onMoveNoteFolder(n.id, "");
        }
      });
    }

    const nextCustom = customFolders.filter(
      (f) => f !== targetPath && !f.startsWith(targetPath + "/")
    );
    setCustomFolders(nextCustom);
    saveCustomFolders(nextCustom);

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.delete(targetPath);
      return next;
    });

    setDeletingFolder(null);
  };

  // 判斷是否為無效放置（避免循環嵌套）
  const isInvalidDropTarget = (targetPath: string, itemToCheck?: DragItemData | null) => {
    const item = itemToCheck || dragItemRef.current || activeDragItem;
    if (!item) return false;
    if (item.type === "note") return false;
    if (item.type === "folder" && item.path) {
      const source = item.path;
      if (source === targetPath) return true;
      if (targetPath.startsWith(source + "/")) return true;
      const currentParent = source.includes("/") ? source.substring(0, source.lastIndexOf("/")) : "";
      if (currentParent === targetPath) return true;
    }
    return false;
  };

  // 執行放置邏輯 (Commit Move)
  const commitDrop = (targetPath: string, payload?: DragItemData | null) => {
    const item = payload || dragItemRef.current || activeDragItem;
    if (!item) return;
    if (isInvalidDropTarget(targetPath, item)) return;

    if (item.type === "note" && item.id) {
      if (onMoveNoteFolder) {
        onMoveNoteFolder(item.id, targetPath);
      }
      if (targetPath) {
        setExpandedFolders((prev) => new Set(prev).add(targetPath));
      }
    } else if (item.type === "folder" && item.path) {
      if (onMoveFolder) {
        onMoveFolder(item.path, targetPath);
      } else {
        const source = item.path;
        const folderName = source.split("/").pop() || "";
        const newPath = targetPath ? `${targetPath}/${folderName}` : folderName;

        const nextCustom = customFolders.map((f) => {
          if (f === source) return newPath;
          if (f.startsWith(source + "/")) return newPath + f.slice(source.length);
          return f;
        });
        setCustomFolders(nextCustom);
        saveCustomFolders(nextCustom);

        if (onMoveNoteFolder) {
          notes.forEach((n) => {
            if (n.folder === source) {
              onMoveNoteFolder(n.id, newPath);
            } else if (n.folder?.startsWith(source + "/")) {
              onMoveNoteFolder(n.id, newPath + n.folder.slice(source.length));
            }
          });
        }
      }
      if (targetPath) {
        setExpandedFolders((prev) => new Set(prev).add(targetPath));
      }
    }
  };

  // ================= 雙軌拖曳引擎 (Universal Pointer DnD) =================
  const startPointerDrag = (e: React.PointerEvent, item: DragItemData) => {
    // 點擊在按鈕或輸入框時不觸發拖曳
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;

    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      item,
    };
    dragItemRef.current = item;

    const handlePointerMove = (moveEvt: PointerEvent) => {
      if (!pointerStartRef.current) return;
      const dx = moveEvt.clientX - pointerStartRef.current.x;
      const dy = moveEvt.clientY - pointerStartRef.current.y;

      // 移動超過 4px 判定為拖曳開始
      if (!isDragging && Math.hypot(dx, dy) > 4) {
        setIsDragging(true);
        setActiveDragItem(pointerStartRef.current.item);
      }

      setDragPos({ x: moveEvt.clientX, y: moveEvt.clientY });

      // 透過坐標偵測當前游標底下的目標元素
      const elem = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY) as HTMLElement | null;
      if (elem) {
        const folderEl = elem.closest("[data-folder-path]") as HTMLElement | null;
        const rootEl = elem.closest("[data-drop-root]") as HTMLElement | null;

        if (folderEl) {
          const path = folderEl.getAttribute("data-folder-path") || "";
          setDragOverPath(path);
          dragOverPathRef.current = path;

          // 自動展開懸浮資料夾
          if (path && !expandedFolders.has(path)) {
            if (!hoverExpandTimerRef.current) {
              hoverExpandTimerRef.current = setTimeout(() => {
                setExpandedFolders((prev) => new Set(prev).add(path));
              }, 450);
            }
          }
        } else if (rootEl) {
          setDragOverPath("");
          dragOverPathRef.current = "";
        } else {
          setDragOverPath(null);
          dragOverPathRef.current = null;
        }
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = null;
      }

      if (dragItemRef.current && dragOverPathRef.current !== null) {
        commitDrop(dragOverPathRef.current, dragItemRef.current);
      }

      setIsDragging(false);
      setActiveDragItem(null);
      setDragOverPath(null);
      dragOverPathRef.current = null;
      dragItemRef.current = null;
      pointerStartRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // 原生 HTML5 Drag 事件支援（增強雙軌保險）
  const handleHtml5DragStart = (e: React.DragEvent, item: DragItemData) => {
    e.stopPropagation();
    dragItemRef.current = item;
    setActiveDragItem(item);
    setIsDragging(true);
    e.dataTransfer.setData("application/json", JSON.stringify(item));
    e.dataTransfer.setData("text/plain", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleHtml5DragOver = (e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInvalidDropTarget(path)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    setDragOverPath(path);
    dragOverPathRef.current = path;
  };

  const handleHtml5Drop = (e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    commitDrop(path);
    setIsDragging(false);
    setActiveDragItem(null);
    setDragOverPath(null);
    dragOverPathRef.current = null;
    dragItemRef.current = null;
  };

  // 搜尋與標籤過濾
  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      const matchSearch =
        search.trim() === "" ||
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));

      const matchTag = !selectedTag || n.tags.includes(selectedTag);

      return matchSearch && matchTag;
    });
  }, [notes, search, selectedTag]);

  // 構建階層樹狀結構
  const rootNode = useMemo(() => {
    const root: FolderNode = {
      path: "",
      name: "根目錄",
      subfolders: [],
      notes: [],
    };

    const allFolderPaths = new Set<string>(customFolders);
    filteredNotes.forEach((n) => {
      if (n.folder) allFolderPaths.add(n.folder);
    });

    const nodeMap = new Map<string, FolderNode>();
    nodeMap.set("", root);

    const sortedPaths = Array.from(allFolderPaths).sort((a, b) => a.localeCompare(b));

    for (const folderPath of sortedPaths) {
      const segments = folderPath.split("/");
      let currentPath = "";
      let parentNode = root;

      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        let node = nodeMap.get(currentPath);

        if (!node) {
          node = {
            path: currentPath,
            name: segment,
            subfolders: [],
            notes: [],
          };
          nodeMap.set(currentPath, node);
          parentNode.subfolders.push(node);
        }
        parentNode = node;
      }
    }

    filteredNotes.forEach((note) => {
      const folderPath = note.folder || "";
      const targetNode = nodeMap.get(folderPath) || root;
      targetNode.notes.push(note);
    });

    return root;
  }, [filteredNotes, customFolders]);

  const handleStartRenameNote = (note: NoteMetadata, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setNameError("");
  };

  const handleSaveRenameNote = (id: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setNameError("筆記名稱不能為空");
      return;
    }
    const exists = notes.some(
      (n) => n.id !== id && n.title.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      setNameError("已存在同名的筆記");
      return;
    }
    onRenameNote(id, trimmed);
    setEditingNoteId(null);
  };

  const openCreateSubfolder = (parentPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTargetParentFolder(parentPath);
    setNewFolderName("");
    setFolderError("");
    setShowCreateFolderModal(true);
  };

  // 遞迴渲染資料夾節點與內部筆記
  const renderFolderNode = (folder: FolderNode, level: number = 0) => {
    const isRoot = folder.path === "";
    const isExpanded = isRoot || expandedFolders.has(folder.path);
    const isTarget = dragOverPath === folder.path;

    return (
      <div key={folder.path || "root"} className="flex flex-col">
        {!isRoot && (
          <div
            data-folder-path={folder.path}
            style={{ paddingLeft: `${Math.max(8, level * 14)}px` }}
            draggable={!renamingFolder}
            onDragStart={(e) =>
              handleHtml5DragStart(e, {
                type: "folder",
                path: folder.path,
                name: folder.name,
              })
            }
            onDragOver={(e) => handleHtml5DragOver(e, folder.path)}
            onDrop={(e) => handleHtml5Drop(e, folder.path)}
            onPointerDown={(e) =>
              startPointerDrag(e, {
                type: "folder",
                path: folder.path,
                name: folder.name,
              })
            }
            onClick={(e) => {
              if (!isDragging) toggleFolder(folder.path, e);
            }}
            className={`group flex items-center justify-between py-1.5 pr-2 rounded-xl text-xs transition cursor-grab active:cursor-grabbing mb-0.5 border ${
              isTarget
                ? "bg-blue-900/80 border-blue-400 ring-2 ring-blue-400/60 text-white font-semibold shadow-lg shadow-blue-950/60"
                : "border-transparent text-slate-300 hover:bg-slate-800/80 hover:text-white"
            }`}
            title={`資料夾：${folder.path}（按住可拖曳移動，或釋放筆記至此）`}
          >
            <div className="flex items-center space-x-1.5 overflow-hidden pr-1 pointer-events-none">
              <span className="text-[10px] text-slate-400 group-hover:text-cyan-400 transition-transform">
                {isExpanded ? "▼" : "▶"}
              </span>
              <span className="text-sm">📁</span>
              <span className="truncate font-medium text-slate-200 group-hover:text-cyan-300">
                {folder.name}
              </span>
              <span className="text-[10px] text-slate-500">
                ({folder.notes.length + folder.subfolders.length})
              </span>
            </div>

            {/* 資料夾操作按鈕列 */}
            <div
              className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 transition shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onCreateNote(undefined, folder.path)}
                title={`在「${folder.name}」中建立筆記`}
                className="w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-blue-700/60 transition"
              >
                +
              </button>

              <button
                type="button"
                onClick={(e) => openCreateSubfolder(folder.path, e)}
                title={`在「${folder.name}」中新增子資料夾`}
                className="w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-amber-300 hover:bg-slate-700 transition text-[11px]"
              >
                📁+
              </button>

              <button
                type="button"
                onClick={() =>
                  setRenamingFolder({ oldPath: folder.path, newName: folder.name })
                }
                title="重新命名資料夾"
                className="w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-indigo-300 hover:bg-slate-700 transition text-[11px]"
              >
                ✏️
              </button>

              <button
                type="button"
                onClick={() =>
                  setDeletingFolder({
                    path: folder.path,
                    count: folder.notes.length,
                  })
                }
                title="刪除資料夾"
                className="w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-700 transition text-[11px]"
              >
                🗑️
              </button>
            </div>
          </div>
        )}

        {/* 展開時渲染子項目 */}
        {isExpanded && (
          <div className="flex flex-col">
            {folder.subfolders.map((sub) => renderFolderNode(sub, level + 1))}

            {folder.notes.map((note) => {
              const isEditing = editingNoteId === note.id;
              const isActive = activeNoteId === note.id;
              const isNoteTarget = dragOverPath === folder.path;

              return (
                <div
                  key={note.id}
                  data-folder-path={folder.path}
                  style={{
                    paddingLeft: `${Math.max(
                      14,
                      (isRoot ? level : level + 1) * 14 + 10
                    )}px`,
                  }}
                  draggable={!isEditing}
                  onDragStart={(e) =>
                    handleHtml5DragStart(e, {
                      type: "note",
                      id: note.id,
                      title: note.title,
                      path: folder.path,
                    })
                  }
                  onDragOver={(e) => handleHtml5DragOver(e, folder.path)}
                  onDrop={(e) => handleHtml5Drop(e, folder.path)}
                  onPointerDown={(e) => {
                    if (!isEditing) {
                      startPointerDrag(e, {
                        type: "note",
                        id: note.id,
                        title: note.title,
                        path: folder.path,
                      });
                    }
                  }}
                  onClick={() => {
                    if (!isDragging && !isEditing) onSelectNote(note.id);
                  }}
                  className={`group relative flex items-center justify-between py-1.5 pr-2 rounded-xl text-xs transition cursor-grab active:cursor-grabbing mb-0.5 border ${
                    isActive
                      ? "bg-cyan-950/35 text-cyan-200 font-medium border-l-2 border-cyan-500 border-t-transparent border-r-transparent border-b-transparent"
                      : isNoteTarget && isDragging
                      ? "bg-cyan-950/60 border-cyan-400/80 text-cyan-200"
                      : "border-transparent text-slate-400 hover:bg-white/4 hover:text-slate-200"
                  }`}
                  title={`${note.title}（按住拖曳可歸入任意資料夾）`}
                >
                  <div className="flex items-center space-x-1.5 overflow-hidden pr-2 pointer-events-none">
                    <span className="text-[12px] opacity-70">📄</span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => handleSaveRenameNote(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRenameNote(note.id);
                          if (e.key === "Escape") setEditingNoteId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        className="bg-slate-900 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none w-36 pointer-events-auto"
                      />
                    ) : (
                      <span className="truncate">{note.title}</span>
                    )}
                  </div>

                  {/* 筆記操作按鈕 */}
                  <div
                    className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 transition shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleStartRenameNote(note, e)}
                      title="重新命名"
                      className="p-1 hover:text-cyan-300 transition"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingNote({ id: note.id, title: note.title });
                      }}
                      title="刪除"
                      className="p-1 hover:text-red-400 transition"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-64 h-full bg-[#111317] border-r border-white/6 flex flex-col select-none">
      {/* 頂部控制列 */}
      <div className="p-3 border-b border-white/6 flex flex-col gap-2.5">
        {/* 頂部操作按鈕列 (已移除左上角名字) */}
        <div className="flex items-center justify-between px-1 pt-0.5">
          <div
            data-drop-root="true"
            onDragOver={(e) => handleHtml5DragOver(e, "")}
            onDrop={(e) => handleHtml5Drop(e, "")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer ${
              dragOverPath === ""
                ? "bg-cyan-950/60 text-cyan-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="拖曳至此處可將筆記移至最外層"
          >
            <span className="font-medium text-xs tracking-wider uppercase text-slate-400">
              檔案庫
            </span>
            {dragOverPath === "" && (
              <span className="text-[10px] text-cyan-400 font-normal">釋放至此</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setTargetParentFolder("");
                setNewFolderName("");
                setFolderError("");
                setShowCreateFolderModal(true);
              }}
              title="新增資料夾"
              className="p-1 hover:bg-white/6 rounded-md text-slate-400 hover:text-slate-200 transition-colors text-xs"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => onCreateNote()}
              title="新增筆記"
              className="p-1 hover:bg-white/6 rounded-md text-slate-400 hover:text-cyan-300 transition-colors text-xs"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* 搜尋列 */}
        <div className="relative">
          <input
            type="text"
            placeholder="搜尋筆記或標籤..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/4 border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-600/60 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* 標籤過濾提示 */}
        {selectedTag && (
          <div className="flex items-center justify-between bg-blue-950/70 border border-blue-800/50 rounded-lg px-2 py-1 text-[11px] text-blue-300">
            <span className="truncate">標籤：#{selectedTag}</span>
            <button
              type="button"
              onClick={onClearTagFilter}
              className="hover:text-white ml-1 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        
      </div>

      {/* 目錄樹列表 */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar"
        data-drop-root="true"
        onDragOver={(e) => {
          if (e.target === e.currentTarget) handleHtml5DragOver(e, "");
        }}
        onDrop={(e) => {
          if (e.target === e.currentTarget) handleHtml5Drop(e, "");
        }}
      >
        {nameError && (
          <div className="text-[11px] text-red-400 px-2 py-1 bg-red-950/50 rounded-lg mb-1">
            {nameError}
          </div>
        )}

        {filteredNotes.length === 0 && customFolders.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-6">尚無筆記</div>
        ) : (
          renderFolderNode(rootNode, 0)
        )}
      </div>

      

      {/* 建立資料夾自訂彈窗 */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <h3 className="text-sm font-semibold mb-1 text-white">
              {targetParentFolder
                ? `在「${targetParentFolder}」內建立子資料夾`
                : "新增資料夾"}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              {targetParentFolder
                ? `階層路徑：${targetParentFolder}/[子資料夾名稱]`
                : "建立於最外層根目錄"}
            </p>

            <input
              type="text"
              placeholder="輸入資料夾名稱..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setShowCreateFolderModal(false);
              }}
              autoFocus
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-2"
            />

            {folderError && (
              <div className="text-[11px] text-red-400 mb-3">{folderError}</div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateFolderModal(false)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="px-4 py-1.5 rounded-xl text-xs font-medium bg-rose-700 hover:bg-rose-600 shadow-sm shadow-rose-950/50 text-white text-white transition shadow-lg shadow-blue-600/30"
              >
                建立
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新命名資料夾自訂彈窗 */}
      {renamingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <h3 className="text-sm font-semibold mb-1 text-white">重新命名資料夾</h3>
            <p className="text-xs text-slate-400 mb-3">原路徑：{renamingFolder.oldPath}</p>

            <input
              type="text"
              value={renamingFolder.newName}
              onChange={(e) =>
                setRenamingFolder({ ...renamingFolder, newName: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameFolder();
                if (e.key === "Escape") setRenamingFolder(null);
              }}
              autoFocus
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-3"
            />

            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setRenamingFolder(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRenameFolder}
                className="px-4 py-1.5 rounded-xl text-xs font-medium bg-rose-700 hover:bg-rose-600 shadow-sm shadow-rose-950/50 text-white text-white transition shadow-lg shadow-blue-600/30"
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除資料夾確認彈窗 */}
      {deletingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <h3 className="text-sm font-semibold mb-1 text-red-400">刪除資料夾</h3>
            <p className="text-xs text-slate-300 mb-3">
              確定要刪除「{deletingFolder.path}」嗎？
              {deletingFolder.count > 0 && (
                <span className="block mt-1 text-blue-300">
                  內部包含 {deletingFolder.count} 篇筆記，將自動移回根目錄安全保存。
                </span>
              )}
            </p>

            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setDeletingFolder(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFolder}
                className="px-4 py-1.5 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition shadow-lg shadow-red-600/30"
              >
                確定刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除筆記確認彈窗 */}
      {deletingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <h3 className="text-sm font-semibold mb-1 text-red-400">確認刪除筆記</h3>
            <p className="text-xs text-slate-300 mb-4">
              您確定要刪除「{deletingNote.title}」嗎？此動作將無法復原。
            </p>

            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setDeletingNote(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteNote(deletingNote.id);
                  setDeletingNote(null);
                }}
                className="px-4 py-1.5 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition shadow-lg shadow-red-600/30"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
