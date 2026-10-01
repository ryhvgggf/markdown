"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  getCustomFolders,
  saveCustomFolders,
} from "@/lib/obsidian/db";
import {
  FolderNode,
  NoteMetadata,
} from "@/lib/obsidian/types";

interface FileTreeProps {
  notes: NoteMetadata[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (
    initialTitle?: string,
    folder?: string
  ) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (
    id: string,
    newTitle: string
  ) => void;
  onMoveNoteFolder?: (
    noteId: string,
    targetFolder: string
  ) => void;
  onMoveFolder?: (
    sourceFolder: string,
    targetParent: string
  ) => void;
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

function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
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
  const [search, setSearch] =
    useState("");

  const [
    editingNoteId,
    setEditingNoteId,
  ] =
    useState<
      string | null
    >(null);

  const [
    editTitle,
    setEditTitle,
  ] =
    useState("");

  const [
    nameError,
    setNameError,
  ] =
    useState("");

  const [
    customFolders,
    setCustomFolders,
  ] =
    useState<string[]>(
      []
    );

  const [
    expandedFolders,
    setExpandedFolders,
  ] =
    useState<Set<string>>(
      new Set()
    );

  const [
    isDragging,
    setIsDragging,
  ] =
    useState(false);

  const [
    activeDragItem,
    setActiveDragItem,
  ] =
    useState<
      DragItemData | null
    >(null);

  const [
    dragPos,
    setDragPos,
  ] =
    useState({
      x: 0,
      y: 0,
    });

  const [
    dragOverPath,
    setDragOverPath,
  ] =
    useState<
      string | null
    >(null);

  const pointerStartRef =
    useRef<{
      x: number;
      y: number;
      item: DragItemData;
    } | null>(
      null
    );

  const dragItemRef =
    useRef<DragItemData | null>(
      null
    );

  const dragOverPathRef =
    useRef<
      string | null
    >(null);

  const hoverExpandTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const [
    showCreateFolderModal,
    setShowCreateFolderModal,
  ] =
    useState(false);

  const [
    targetParentFolder,
    setTargetParentFolder,
  ] =
    useState("");

  const [
    newFolderName,
    setNewFolderName,
  ] =
    useState("");

  const [
    folderError,
    setFolderError,
  ] =
    useState("");

  const [
    renamingFolder,
    setRenamingFolder,
  ] =
    useState<{
      oldPath: string;
      newName: string;
    } | null>(
      null
    );

  const [
    deletingFolder,
    setDeletingFolder,
  ] =
    useState<{
      path: string;
      count: number;
    } | null>(
      null
    );

  const [
    deletingNote,
    setDeletingNote,
  ] =
    useState<{
      id: string;
      title: string;
    } | null>(
      null
    );

  useEffect(() => {
    const folders =
      getCustomFolders();

    setCustomFolders(
      folders
    );

    const initial =
      new Set<string>(
        folders
      );

    for (const note of notes) {
      if (!note.folder) {
        continue;
      }

      const parts =
        note.folder.split(
          "/"
        );

      let current =
        "";

      for (const part of parts) {
        current =
          current
            ? `${current}/${part}`
            : part;

        initial.add(
          current
        );
      }
    }

    setExpandedFolders(
      initial
    );
  }, [notes]);

  const allFolderPaths =
    useMemo(() => {
      const set =
        new Set<string>(
          customFolders.map(
            normalizeFolderPath
          )
        );

      for (const note of notes) {
        if (
          note.folder
        ) {
          const parts =
            normalizeFolderPath(
              note.folder
            ).split(
              "/"
            );

          let current =
            "";

          for (const part of parts) {
            if (!part) continue;

            current =
              current
                ? `${current}/${part}`
                : part;

            set.add(
              current
            );
          }
        }
      }

      return set;
    }, [
      customFolders,
      notes,
    ]);

  const folderExists =
    (
      path: string,
      exceptPath?: string
    ) => {
      const clean =
        normalizeFolderPath(
          path
        );

      if (!clean) {
        return false;
      }

      if (
        exceptPath &&
        clean ===
          normalizeFolderPath(
            exceptPath
          )
      ) {
        return false;
      }

      return allFolderPaths.has(
        clean
      );
    };

  const toggleFolder =
    (
      folderPath: string,
      event?: React.MouseEvent
    ) => {
      event?.stopPropagation();

      setExpandedFolders(
        (previous) => {
          const next =
            new Set(
              previous
            );

          if (
            next.has(
              folderPath
            )
          ) {
            next.delete(
              folderPath
            );
          } else {
            next.add(
              folderPath
            );
          }

          return next;
        }
      );
    };

  const handleCreateFolder =
    () => {
      const name =
        newFolderName
          .trim()
          .replace(
            /^\/+|\/+$/g,
            ""
          );

      if (!name) {
        setFolderError(
          "資料夾名稱不能為空"
        );
        return;
      }

      if (
        name.includes(
          "/"
        )
      ) {
        setFolderError(
          "子資料夾名稱不能包含「/」"
        );
        return;
      }

      const fullPath =
        normalizeFolderPath(
          targetParentFolder
            ? `${targetParentFolder}/${name}`
            : name
        );

      if (
        folderExists(
          fullPath
        )
      ) {
        setFolderError(
          "目標位置已存在同名資料夾"
        );
        return;
      }

      const next =
        Array.from(
          new Set([
            ...customFolders,
            fullPath,
          ])
        );

      setCustomFolders(
        next
      );

      saveCustomFolders(
        next
      );

      setExpandedFolders(
        (previous) => {
          const result =
            new Set(
              previous
            );

          result.add(
            fullPath
          );

          if (
            targetParentFolder
          ) {
            result.add(
              targetParentFolder
            );
          }

          return result;
        }
      );

      setShowCreateFolderModal(
        false
      );

      setTargetParentFolder(
        ""
      );

      setNewFolderName(
        ""
      );

      setFolderError(
        ""
      );
  };

  const handleRenameFolder =
    () => {
      if (
        !renamingFolder
      ) {
        return;
      }

      const newName =
        renamingFolder
          .newName
          .trim()
          .replace(
            /^\/+|\/+$/g,
            ""
          );

      if (!newName) {
        setFolderError(
          "資料夾名稱不能為空"
        );
        return;
      }

      if (
        newName.includes(
          "/"
        )
      ) {
        setFolderError(
          "資料夾名稱不能包含「/」"
        );
        return;
      }

      const oldPath =
        normalizeFolderPath(
          renamingFolder.oldPath
        );

      const parent =
        oldPath.includes(
          "/"
        )
          ? oldPath.substring(
              0,
              oldPath.lastIndexOf(
                "/"
              )
            )
          : "";

      const newPath =
        normalizeFolderPath(
          parent
            ? `${parent}/${newName}`
            : newName
        );

      if (
        newPath ===
        oldPath
      ) {
        setRenamingFolder(
          null
        );

        setFolderError(
          ""
        );

        return;
      }

      if (
        folderExists(
          newPath,
          oldPath
        )
      ) {
        setFolderError(
          "同一層已存在同名資料夾"
        );
        return;
      }

      const next =
        customFolders.map(
          (path) => {
            if (
              path ===
              oldPath
            ) {
              return newPath;
            }

            if (
              path.startsWith(
                `${oldPath}/`
              )
            ) {
              return (
                newPath +
                path.slice(
                  oldPath.length
                )
              );
            }

            return path;
          }
        );

      setCustomFolders(
        next
      );

      saveCustomFolders(
        next
      );

      if (
        onMoveNoteFolder
      ) {
        for (const note of notes) {
          if (
            note.folder ===
            oldPath
          ) {
            onMoveNoteFolder(
              note.id,
              newPath
            );
          } else if (
            note.folder?.startsWith(
              `${oldPath}/`
            )
          ) {
            onMoveNoteFolder(
              note.id,
              newPath +
                note.folder.slice(
                  oldPath.length
                )
            );
          }
        }
      }

      setExpandedFolders(
        (previous) => {
          const result =
            new Set<string>();

          for (const path of previous) {
            if (
              path ===
              oldPath
            ) {
              result.add(
                newPath
              );
            } else if (
              path.startsWith(
                `${oldPath}/`
              )
            ) {
              result.add(
                newPath +
                  path.slice(
                    oldPath.length
                  )
              );
            } else {
              result.add(
                path
              );
            }
          }

          return result;
        }
      );

      setRenamingFolder(
        null
      );

      setFolderError(
        ""
      );
  };

  const handleConfirmDeleteFolder =
    () => {
      if (
        !deletingFolder
      ) {
        return;
      }

      const target =
        normalizeFolderPath(
          deletingFolder.path
        );

      if (
        onMoveNoteFolder
      ) {
        for (const note of notes) {
          if (
            note.folder ===
              target ||
            note.folder?.startsWith(
              `${target}/`
            )
          ) {
            onMoveNoteFolder(
              note.id,
              ""
            );
          }
        }
      }

      const next =
        customFolders.filter(
          (path) =>
            path !==
              target &&
            !path.startsWith(
              `${target}/`
            )
        );

      setCustomFolders(
        next
      );

      saveCustomFolders(
        next
      );

      setExpandedFolders(
        (previous) => {
          const result =
            new Set(
              previous
            );

          for (const path of result) {
            if (
              path ===
                target ||
              path.startsWith(
                `${target}/`
              )
            ) {
              result.delete(
                path
              );
            }
          }

          return result;
        }
      );

      setDeletingFolder(
        null
      );
  };

  const isInvalidDropTarget =
    (
      targetPath: string,
      item?: DragItemData | null
    ) => {
      const current =
        item ||
        dragItemRef.current ||
        activeDragItem;

      if (!current) {
        return false;
      }

      if (
        current.type ===
        "note"
      ) {
        return false;
      }

      const source =
        normalizeFolderPath(
          current.path || ""
        );

      const target =
        normalizeFolderPath(
          targetPath
        );

      if (!source) {
        return false;
      }

      if (
        source ===
        target
      ) {
        return true;
      }

      if (
        target.startsWith(
          `${source}/`
        )
      ) {
        return true;
      }

      const currentParent =
        source.includes(
          "/"
        )
          ? source.substring(
              0,
              source.lastIndexOf(
                "/"
              )
            )
          : "";

      return (
        currentParent ===
        target
      );
    };

  const commitDrop =
    (
      targetPath: string,
      payload?: DragItemData | null
    ) => {
      const item =
        payload ||
        dragItemRef.current ||
        activeDragItem;

      if (!item) {
        return;
      }

      const target =
        normalizeFolderPath(
          targetPath
        );

      if (
        isInvalidDropTarget(
          target,
          item
        )
      ) {
        return;
      }

      if (
        item.type ===
          "note" &&
        item.id
      ) {
        onMoveNoteFolder?.(
          item.id,
          target
        );

        if (target) {
          setExpandedFolders(
            (previous) =>
              new Set(
                previous
              ).add(
                target
              )
          );
        }

        return;
      }

      if (
        item.type ===
          "folder" &&
        item.path
      ) {
        const source =
          normalizeFolderPath(
            item.path
          );

        const folderName =
          source
            .split(
              "/"
            )
            .pop() || "";

        const newPath =
          normalizeFolderPath(
            target
              ? `${target}/${folderName}`
              : folderName
          );

        if (
          folderExists(
            newPath,
            source
          )
        ) {
          setNameError(
            "移動失敗：目標位置已存在同名資料夾"
          );
          return;
        }

        setNameError(
          ""
        );

        /*
         * 先更新 FileTree 自己的 customFolders，
         * 即使是空資料夾也能立即反映移動結果。
         */
        const next =
          customFolders.map(
            (path) => {
              if (
                path ===
                source
              ) {
                return newPath;
              }

              if (
                path.startsWith(
                  `${source}/`
                )
              ) {
                return (
                  newPath +
                  path.slice(
                    source.length
                  )
                );
              }

              return path;
            }
          );

        setCustomFolders(
          next
        );

        saveCustomFolders(
          next
        );

        if (
          onMoveFolder
        ) {
          onMoveFolder(
            source,
            target
          );
        } else if (
          onMoveNoteFolder
        ) {
          for (const note of notes) {
            if (
              note.folder ===
              source
            ) {
              onMoveNoteFolder(
                note.id,
                newPath
              );
            } else if (
              note.folder?.startsWith(
                `${source}/`
              )
            ) {
              onMoveNoteFolder(
                note.id,
                newPath +
                  note.folder.slice(
                    source.length
                  )
              );
            }
          }
        }

        if (target) {
          setExpandedFolders(
            (previous) =>
              new Set(
                previous
              ).add(
                target
              )
          );
        }
      }
    };

  const startPointerDrag =
    (
      event: React.PointerEvent,
      item: DragItemData
    ) => {
      const target =
        event.target as HTMLElement;

      if (
        target.closest(
          "button"
        ) ||
        target.closest(
          "input"
        )
      ) {
        return;
      }

      pointerStartRef.current =
        {
          x: event.clientX,
          y: event.clientY,
          item,
        };

      dragItemRef.current =
        item;

      const onMove =
        (
          moveEvent: PointerEvent
        ) => {
          const start =
            pointerStartRef.current;

          if (!start) {
            return;
          }

          const distance =
            Math.hypot(
              moveEvent.clientX -
                start.x,
              moveEvent.clientY -
                start.y
            );

          if (
            distance >
              4 &&
            !isDragging
          ) {
            setIsDragging(
              true
            );

            setActiveDragItem(
              start.item
            );
          }

          setDragPos({
            x: moveEvent.clientX,
            y: moveEvent.clientY,
          });

          const element =
            document.elementFromPoint(
              moveEvent.clientX,
              moveEvent.clientY
            ) as HTMLElement | null;

          const folderElement =
            element?.closest<HTMLElement>(
              "[data-folder-path]"
            );

          const rootElement =
            element?.closest<HTMLElement>(
              "[data-drop-root]"
            );

          if (
            folderElement
          ) {
            const path =
              folderElement.getAttribute(
                "data-folder-path"
              ) || "";

            setDragOverPath(
              path
            );

            dragOverPathRef.current =
              path;

            if (
              path &&
              !expandedFolders.has(
                path
              ) &&
              !hoverExpandTimerRef.current
            ) {
              hoverExpandTimerRef.current =
                setTimeout(
                  () => {
                    setExpandedFolders(
                      (previous) =>
                        new Set(
                          previous
                        ).add(
                          path
                        )
                    );

                    hoverExpandTimerRef.current =
                      null;
                  },
                  420
                );
            }
          } else if (
            rootElement
          ) {
            setDragOverPath(
              ""
            );

            dragOverPathRef.current =
              "";
          } else {
            setDragOverPath(
              null
            );

            dragOverPathRef.current =
              null;
          }
        };

      const onUp =
        () => {
          window.removeEventListener(
            "pointermove",
            onMove
          );

          window.removeEventListener(
            "pointerup",
            onUp
          );

          if (
            hoverExpandTimerRef.current
          ) {
            clearTimeout(
              hoverExpandTimerRef.current
            );

            hoverExpandTimerRef.current =
              null;
          }

          if (
            dragItemRef.current &&
            dragOverPathRef.current !==
              null
          ) {
            commitDrop(
              dragOverPathRef.current,
              dragItemRef.current
            );
          }

          setIsDragging(
            false
          );

          setActiveDragItem(
            null
          );

          setDragOverPath(
            null
          );

          dragOverPathRef.current =
            null;

          dragItemRef.current =
            null;

          pointerStartRef.current =
            null;
        };

      window.addEventListener(
        "pointermove",
        onMove
      );

      window.addEventListener(
        "pointerup",
        onUp
      );
    };

  const handleHtml5DragStart =
    (
      event: React.DragEvent,
      item: DragItemData
    ) => {
      event.stopPropagation();

      dragItemRef.current =
        item;

      setActiveDragItem(
        item
      );

      setIsDragging(
        true
      );

      event.dataTransfer.setData(
        "application/json",
        JSON.stringify(
          item
        )
      );

      event.dataTransfer.effectAllowed =
        "move";
    };

  const handleHtml5DragOver =
    (
      event: React.DragEvent,
      path: string
    ) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        isInvalidDropTarget(
          path
        )
      ) {
        event.dataTransfer.dropEffect =
          "none";
        return;
      }

      event.dataTransfer.dropEffect =
        "move";

      setDragOverPath(
        path
      );

      dragOverPathRef.current =
        path;
    };

  const handleHtml5Drop =
    (
      event: React.DragEvent,
      path: string
    ) => {
      event.preventDefault();
      event.stopPropagation();

      let payload:
        | DragItemData
        | null =
        dragItemRef.current;

      if (!payload) {
        try {
          const raw =
            event.dataTransfer.getData(
              "application/json"
            );

          payload =
            raw
              ? JSON.parse(
                  raw
                )
              : null;
        } catch {
          payload =
            null;
        }
      }

      commitDrop(
        path,
        payload
      );

      setIsDragging(
        false
      );

      setActiveDragItem(
        null
      );

      setDragOverPath(
        null
      );

      dragOverPathRef.current =
        null;

      dragItemRef.current =
        null;
    };

  const filteredNotes =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return notes.filter(
        (note) => {
          const matchSearch =
            !query ||
            note.title
              .toLowerCase()
              .includes(
                query
              ) ||
            note.tags.some(
              (tag) =>
                tag
                  .toLowerCase()
                  .includes(
                    query
                  )
            );

          const matchTag =
            !selectedTag ||
            note.tags.includes(
              selectedTag
            );

          return (
            matchSearch &&
            matchTag
          );
        }
      );
    }, [
      notes,
      search,
      selectedTag,
    ]);

  const rootNode =
    useMemo(() => {
      const root:
        FolderNode =
        {
          path: "",
          name: "根目錄",
          subfolders: [],
          notes: [],
        };

      const paths =
        new Set<string>(
          customFolders
        );

      for (const note of filteredNotes) {
        if (
          note.folder
        ) {
          paths.add(
            note.folder
          );
        }
      }

      const nodeMap =
        new Map<
          string,
          FolderNode
        >();

      nodeMap.set(
        "",
        root
      );

      const sortedPaths =
        Array.from(
          paths
        ).sort(
          (a, b) =>
            a.localeCompare(
              b
            )
        );

      for (const path of sortedPaths) {
        const segments =
          path
            .split(
              "/"
            )
            .filter(
              Boolean
            );

        let currentPath =
          "";

        let parent =
          root;

        for (const segment of segments) {
          currentPath =
            currentPath
              ? `${currentPath}/${segment}`
              : segment;

          let node =
            nodeMap.get(
              currentPath
            );

          if (!node) {
            node = {
              path:
                currentPath,
              name: segment,
              subfolders:
                [],
              notes: [],
            };

            nodeMap.set(
              currentPath,
              node
            );

            parent.subfolders.push(
              node
            );
          }

          parent =
            node;
        }
      }

      for (const note of filteredNotes) {
        const target =
          nodeMap.get(
            note.folder || ""
          ) || root;

        target.notes.push(
          note
        );
      }

      return root;
    }, [
      filteredNotes,
      customFolders,
    ]);

  const handleStartRenameNote =
    (
      note: NoteMetadata,
      event: React.MouseEvent
    ) => {
      event.stopPropagation();

      setEditingNoteId(
        note.id
      );

      setEditTitle(
        note.title
      );

      setNameError(
        ""
      );
    };

  const handleSaveRenameNote =
    (
      noteId: string
    ) => {
      const title =
        editTitle.trim();

      if (!title) {
        setNameError(
          "筆記名稱不能為空"
        );
        return;
      }

      const duplicate =
        notes.some(
          (note) =>
            note.id !==
              noteId &&
            note.title
              .trim()
              .toLowerCase() ===
              title.toLowerCase()
        );

      if (
        duplicate
      ) {
        setNameError(
          "已存在同名筆記"
        );
        return;
      }

      onRenameNote(
        noteId,
        title
      );

      setEditingNoteId(
        null
      );

      setNameError(
        ""
      );
    };

  const openCreateSubfolder =
    (
      parentPath: string,
      event: React.MouseEvent
    ) => {
      event.stopPropagation();

      setTargetParentFolder(
        parentPath
      );

      setNewFolderName(
        ""
      );

      setFolderError(
        ""
      );

      setShowCreateFolderModal(
        true
      );
    };

  const renderFolderNode =
    (
      folder: FolderNode,
      level: number
    ): React.ReactNode => {
      const isRoot =
        folder.path === "";

      const isExpanded =
        isRoot ||
        expandedFolders.has(
          folder.path
        );

      const isTarget =
        dragOverPath ===
        folder.path;

      return (
        <div
          key={
            folder.path ||
            "root"
          }
        >
          {!isRoot && (
            <div
              data-folder-path={
                folder.path
              }
              draggable
              style={{
                paddingLeft:
                  `${Math.max(
                    6,
                    level *
                      14
                  )}px`,
              }}
              onDragStart={(
                event
              ) =>
                handleHtml5DragStart(
                  event,
                  {
                    type: "folder",
                    path:
                      folder.path,
                    name:
                      folder.name,
                  }
                )
              }
              onDragOver={(
                event
              ) =>
                handleHtml5DragOver(
                  event,
                  folder.path
                )
              }
              onDrop={(
                event
              ) =>
                handleHtml5Drop(
                  event,
                  folder.path
                )
              }
              onPointerDown={(
                event
              ) =>
                startPointerDrag(
                  event,
                  {
                    type: "folder",
                    path:
                      folder.path,
                    name:
                      folder.name,
                  }
                )
              }
              onClick={(
                event
              ) => {
                if (
                  !isDragging
                ) {
                  toggleFolder(
                    folder.path,
                    event
                  );
                }
              }}
              className={`group mb-0.5 flex cursor-grab items-center justify-between border py-1.5 pr-2 text-xs transition active:cursor-grabbing ${
                isTarget
                  ? "border-cyan-500/50 bg-cyan-950/30 text-white"
                  : "border-transparent text-slate-300 hover:bg-white/[0.03]"
              }`}
              title={`資料夾：${folder.path}（按住可拖曳移動，或釋放筆記至此）`}
            >
              <div className="pointer-events-none flex min-w-0 items-center gap-1.5">
                <span className="text-[9px] text-slate-500">
                  {isExpanded
                    ? "▼"
                    : "▶"}
                </span>

                <span className="truncate font-serif text-slate-300">
                  {folder.name}
                </span>

                <span className="text-[9px] text-slate-600">
                  {folder.notes.length +
                    folder.subfolders.length}
                </span>
              </div>

              <div
                className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100"
                onClick={(
                  event
                ) =>
                  event.stopPropagation()
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    onCreateNote(
                      undefined,
                      folder.path
                    )
                  }
                  title={`在「${folder.name}」中建立筆記`}
                  className="px-1 text-slate-500 hover:text-slate-200"
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={(
                    event
                  ) =>
                    openCreateSubfolder(
                      folder.path,
                      event
                    )
                  }
                  title={`在「${folder.name}」中新增子資料夾`}
                  className="px-1 text-slate-500 hover:text-cyan-300"
                >
                  子
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRenamingFolder({
                      oldPath:
                        folder.path,
                      newName:
                        folder.name,
                    });

                    setFolderError(
                      ""
                    );
                  }}
                  title="重新命名資料夾"
                  className="px-1 text-slate-500 hover:text-slate-200"
                >
                  改
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeletingFolder({
                      path:
                        folder.path,
                      count:
                        folder.notes.length,
                    })
                  }
                  title="刪除資料夾"
                  className="px-1 text-slate-500 hover:text-red-300"
                >
                  刪
                </button>
              </div>
            </div>
          )}

          {isExpanded && (
            <div>
              {folder.subfolders.map(
                (child) =>
                  renderFolderNode(
                    child,
                    level + 1
                  )
              )}

              {folder.notes.map(
                (note) => {
                  const isEditing =
                    editingNoteId ===
                    note.id;

                  const isActive =
                    activeNoteId ===
                    note.id;

                  return (
                    <div
                      key={
                        note.id
                      }
                      data-folder-path={
                        folder.path
                      }
                      draggable={
                        !isEditing
                      }
                      style={{
                        paddingLeft:
                          `${Math.max(
                            14,
                            (isRoot
                              ? level
                              : level +
                                1) *
                              14 +
                              10
                          )}px`,
                      }}
                      onDragStart={(
                        event
                      ) =>
                        handleHtml5DragStart(
                          event,
                          {
                            type: "note",
                            id:
                              note.id,
                            title:
                              note.title,
                            path:
                              folder.path,
                          }
                        )
                      }
                      onDragOver={(
                        event
                      ) =>
                        handleHtml5DragOver(
                          event,
                          folder.path
                        )
                      }
                      onDrop={(
                        event
                      ) =>
                        handleHtml5Drop(
                          event,
                          folder.path
                        )
                      }
                      onPointerDown={(
                        event
                      ) => {
                        if (
                          !isEditing
                        ) {
                          startPointerDrag(
                            event,
                            {
                              type: "note",
                              id:
                                note.id,
                              title:
                                note.title,
                              path:
                                folder.path,
                            }
                          );
                        }
                      }}
                      onClick={() => {
                        if (
                          !isDragging &&
                          !isEditing
                        ) {
                          onSelectNote(
                            note.id
                          );
                        }
                      }}
                      className={`group relative mb-0.5 flex cursor-grab items-center justify-between border py-1.5 pr-2 text-xs transition active:cursor-grabbing ${
                        isActive
                          ? "border-l-2 border-l-cyan-500 border-t-transparent border-r-transparent border-b-transparent bg-cyan-950/20 text-cyan-100"
                          : "border-transparent text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
                      }`}
                      title={`${note.title}（按住拖曳可歸入任意資料夾）`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        {isEditing ? (
                          <input
                            value={
                              editTitle
                            }
                            onChange={(
                              event
                            ) =>
                              setEditTitle(
                                event
                                  .target
                                  .value
                              )
                            }
                            onBlur={() =>
                              handleSaveRenameNote(
                                note.id
                              )
                            }
                            onKeyDown={(
                              event
                            ) => {
                              if (
                                event.key ===
                                "Enter"
                              ) {
                                handleSaveRenameNote(
                                  note.id
                                );
                              }

                              if (
                                event.key ===
                                "Escape"
                              ) {
                                setEditingNoteId(
                                  null
                                );
                              }
                            }}
                            autoFocus
                            onClick={(
                              event
                            ) =>
                              event.stopPropagation()
                            }
                            className="w-full border-b border-cyan-600/50 bg-transparent px-1 py-0.5 text-xs text-white outline-none"
                          />
                        ) : (
                          <span className="block truncate">
                            {
                              note.title
                            }
                          </span>
                        )}
                      </div>

                      <div
                        className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100"
                        onClick={(
                          event
                        ) =>
                          event.stopPropagation()
                        }
                      >
                        <button
                          type="button"
                          title="重新命名"
                          onClick={(
                            event
                          ) =>
                            handleStartRenameNote(
                              note,
                              event
                            )
                          }
                          className="px-1 text-slate-500 hover:text-cyan-300"
                        >
                          改
                        </button>

                        <button
                          type="button"
                          title="刪除"
                          onClick={(
                            event
                          ) => {
                            event.stopPropagation();

                            setDeletingNote({
                              id:
                                note.id,
                              title:
                                note.title,
                            });
                          }}
                          className="px-1 text-slate-500 hover:text-red-300"
                        >
                          刪
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </div>
      );
    };

  const modalPortal =
    (
      content: React.ReactNode
    ) => {
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
    };

  return (
    <>
      <aside className="flex h-full w-64 select-none flex-col border-r border-white/5 bg-transparent">
        <div className="flex flex-col gap-2.5 border-b border-white/5 p-3">
          <div className="flex items-center justify-between px-1">
            <div
              data-drop-root="true"
              onDragOver={(
                event
              ) =>
                handleHtml5DragOver(
                  event,
                  ""
                )
              }
              onDrop={(
                event
              ) =>
                handleHtml5Drop(
                  event,
                  ""
                )
              }
              className={`text-xs tracking-wider ${
                dragOverPath ===
                ""
                  ? "text-cyan-200"
                  : "text-slate-400"
              }`}
              title="拖曳至此可移至最外層"
            >
              檔案庫
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setTargetParentFolder(
                    ""
                  );

                  setNewFolderName(
                    ""
                  );

                  setFolderError(
                    ""
                  );

                  setShowCreateFolderModal(
                    true
                  );
                }}
                title="新增資料夾"
                className="px-1.5 text-slate-500 hover:text-slate-200"
              >
                ▱+
              </button>

              <button
                type="button"
                onClick={() =>
                  onCreateNote()
                }
                title="新增筆記"
                className="px-1.5 text-slate-500 hover:text-cyan-300"
              >
                ＋
              </button>
            </div>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="搜尋筆記或標籤..."
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
              className="w-full border-b border-white/10 bg-black/10 px-2 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-700/60"
            />

            {search && (
              <button
                type="button"
                onClick={() =>
                  setSearch(
                    ""
                  )
                }
                className="absolute right-2 top-1.5 text-xs text-slate-500 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {selectedTag && (
            <div className="flex items-center justify-between border border-cyan-800/30 bg-cyan-950/15 px-2 py-1 text-[10px] text-cyan-300">
              <span className="truncate">
                #{selectedTag}
              </span>

              <button
                type="button"
                onClick={
                  onClearTagFilter
                }
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div
          className="flex-1 overflow-y-auto p-2"
          data-drop-root="true"
          onDragOver={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              handleHtml5DragOver(
                event,
                ""
              );
            }
          }}
          onDrop={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              handleHtml5Drop(
                event,
                ""
              );
            }
          }}
        >
          {nameError && (
            <div className="mb-2 border border-red-500/20 bg-red-950/20 px-2 py-1 text-[10px] text-red-300">
              {nameError}
            </div>
          )}

          {filteredNotes.length ===
            0 &&
          customFolders.length ===
            0 ? (
            <div className="py-8 text-center text-xs text-slate-600">
              尚無筆記
            </div>
          ) : (
            renderFolderNode(
              rootNode,
              0
            )
          )}
        </div>
      </aside>

      {isDragging &&
        activeDragItem && (
          <div
            className="pointer-events-none fixed z-[13000] border border-cyan-600/30 bg-[#111415]/95 px-2 py-1 text-[10px] text-slate-200 shadow-xl"
            style={{
              left:
                dragPos.x +
                12,
              top:
                dragPos.y +
                12,
            }}
          >
            {activeDragItem.type ===
            "folder"
              ? `資料夾：${
                  activeDragItem.name ||
                  activeDragItem.path
                }`
              : `筆記：${
                  activeDragItem.title ||
                  ""
                }`}
          </div>
        )}

      {showCreateFolderModal &&
        modalPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <h3 className="font-serif text-sm text-white">
                {targetParentFolder
                  ? `在「${targetParentFolder}」建立子資料夾`
                  : "新增資料夾"}
              </h3>

              <input
                type="text"
                value={
                  newFolderName
                }
                onChange={(
                  event
                ) =>
                  setNewFolderName(
                    event
                      .target
                      .value
                  )
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    handleCreateFolder();
                  }

                  if (
                    event.key ===
                    "Escape"
                  ) {
                    setShowCreateFolderModal(
                      false
                    );
                  }
                }}
                autoFocus
                placeholder="資料夾名稱"
                className="mt-4 w-full border-b border-white/15 bg-transparent px-1 py-2 text-xs text-white outline-none focus:border-cyan-700"
              />

              {folderError && (
                <div className="mt-2 text-[10px] text-red-300">
                  {
                    folderError
                  }
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowCreateFolderModal(
                      false
                    )
                  }
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={
                    handleCreateFolder
                  }
                  className="border border-cyan-700/40 px-4 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/30"
                >
                  建立
                </button>
              </div>
            </div>
          </div>
        )}

      {renamingFolder &&
        modalPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <h3 className="font-serif text-sm text-white">
                重新命名資料夾
              </h3>

              <p className="mt-1 text-[10px] text-slate-500">
                {
                  renamingFolder.oldPath
                }
              </p>

              <input
                type="text"
                value={
                  renamingFolder.newName
                }
                onChange={(
                  event
                ) =>
                  setRenamingFolder({
                    ...renamingFolder,
                    newName:
                      event
                        .target
                        .value,
                  })
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    handleRenameFolder();
                  }

                  if (
                    event.key ===
                    "Escape"
                  ) {
                    setRenamingFolder(
                      null
                    );
                  }
                }}
                autoFocus
                className="mt-4 w-full border-b border-white/15 bg-transparent px-1 py-2 text-xs text-white outline-none focus:border-cyan-700"
              />

              {folderError && (
                <div className="mt-2 text-[10px] text-red-300">
                  {
                    folderError
                  }
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setRenamingFolder(
                      null
                    )
                  }
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={
                    handleRenameFolder
                  }
                  className="border border-cyan-700/40 px-4 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/30"
                >
                  儲存
                </button>
              </div>
            </div>
          </div>
        )}

      {deletingFolder &&
        modalPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <h3 className="font-serif text-sm text-red-300">
                刪除資料夾
              </h3>

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                確定刪除「
                {
                  deletingFolder.path
                }
                」嗎？
              </p>

              <p className="mt-2 text-[10px] text-slate-500">
                資料夾內的筆記不會刪除，會移回根目錄。
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDeletingFolder(
                      null
                    )
                  }
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={
                    handleConfirmDeleteFolder
                  }
                  className="border border-red-600/40 px-4 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                >
                  確定刪除
                </button>
              </div>
            </div>
          </div>
        )}

      {deletingNote &&
        modalPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm border border-white/10 bg-[#111416]/98 p-5 text-slate-200 shadow-2xl">
              <h3 className="font-serif text-sm text-red-300">
                確認刪除筆記
              </h3>

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                確定要刪除「
                {
                  deletingNote.title
                }
                」嗎？此動作無法復原。
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDeletingNote(
                      null
                    )
                  }
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDeleteNote(
                      deletingNote.id
                    );

                    setDeletingNote(
                      null
                    );
                  }}
                  className="border border-red-600/40 px-4 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                >
                  確認刪除
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
