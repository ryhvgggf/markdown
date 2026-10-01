"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildGraphData,
  buildLocalGraphData,
} from "@/lib/obsidian/links";

import {
  GraphData,
  GraphNode,
  Note,
  NoteMetadata,
} from "@/lib/obsidian/types";

interface GraphViewProps {
  notes:
    Array<
      Note | NoteMetadata
    >;

  activeNoteId:
    string | null;

  onSelectNote: (
    noteId: string
  ) => void;

  onClose?: () => void;
}

interface DragState {
  mode:
    | "none"
    | "canvas"
    | "node";

  nodeId:
    | string
    | null;

  lastX: number;
  lastY: number;

  downX: number;
  downY: number;

  moved: boolean;
}

export function GraphView({
  notes,
  activeNoteId,
  onSelectNote,
  onClose,
}: GraphViewProps) {
  const canvasRef =
    useRef<HTMLCanvasElement>(
      null
    );

  const wrapperRef =
    useRef<HTMLDivElement>(
      null
    );

  const transformRef =
    useRef({
      scale: 1,
      x: 0,
      y: 0,
    });

  const dragRef =
    useRef<DragState>({
      mode: "none",
      nodeId: null,

      lastX: 0,
      lastY: 0,

      downX: 0,
      downY: 0,

      moved: false,
    });

  const [graphMode, setGraphMode] =
    useState<
      "global" | "local"
    >(
      activeNoteId
        ? "local"
        : "global"
    );

  const [filterQuery, setFilterQuery] =
    useState("");

  const [
    hoveredNodeId,
    setHoveredNodeId,
  ] =
    useState<
      string | null
    >(null);

  const [
    isFullscreen,
    setIsFullscreen,
  ] =
    useState(false);

  const [
    maxNodesLimit,
  ] =
    useState(300);

  const [
    layoutVersion,
    setLayoutVersion,
  ] =
    useState(0);

  /**
   * ============================
   * 建立 Graph Data
   * ============================
   */
  const graphResult =
    useMemo(() => {
      if (
        graphMode ===
          "local" &&
        activeNoteId
      ) {
        const local =
          buildLocalGraphData(
            activeNoteId,
            notes
          );

        return {
          data: local,
          isCapped: false,
        };
      }

      const raw =
        buildGraphData(
          notes,
          maxNodesLimit
        ) as GraphData & {
          isCapped?: boolean;
        };

      return {
        data: {
          nodes:
            raw.nodes,
          links:
            raw.links,
        } as GraphData,

        isCapped:
          Boolean(
            raw.isCapped
          ),
      };
    }, [
      notes,
      graphMode,
      activeNoteId,
      maxNodesLimit,
    ]);

  const [
    graphData,
    setGraphData,
  ] =
    useState<GraphData>(
      graphResult.data
    );

  /**
   * ============================
   * 水墨散點排列
   * ============================
   */
  const arrangeNodes =
    useCallback(
      (
        data: GraphData
      ): GraphData => {
        const count =
          data.nodes.length;

        const nodes =
          data.nodes.map(
            (
              node,
              index
            ) => {
              /**
               * Active Node 放中央。
               */
              if (
                node.id ===
                  activeNoteId &&
                graphMode ===
                  "local"
              ) {
                return {
                  ...node,
                  x: 0,
                  y: 0,
                  vx: 0,
                  vy: 0,
                };
              }

              /**
               * 使用黃金角，
               * 讓點像墨滴自然散開。
               */
              const goldenAngle =
                Math.PI *
                (
                  3 -
                  Math.sqrt(
                    5
                  )
                );

              const adjustedIndex =
                graphMode ===
                  "local" &&
                activeNoteId
                  ? index + 1
                  : index;

              const angle =
                adjustedIndex *
                goldenAngle;

              const ring =
                Math.sqrt(
                  adjustedIndex +
                    1
                );

              const distance =
                graphMode ===
                "local"
                  ? 92 *
                    ring
                  : 58 *
                    ring;

              return {
                ...node,

                x:
                  Math.cos(
                    angle
                  ) *
                  distance,

                y:
                  Math.sin(
                    angle
                  ) *
                  distance,

                vx: 0,
                vy: 0,
              };
            }
          );

        return {
          nodes,
          links:
            data.links,
        };
      },
      [
        activeNoteId,
        graphMode,
      ]
    );

  /**
   * Graph Data 改變。
   */
  useEffect(() => {
    setGraphData(
      arrangeNodes(
        graphResult.data
      )
    );

    transformRef.current = {
      scale: 1,
      x: 0,
      y: 0,
    };

    setLayoutVersion(
      (version) =>
        version + 1
    );
  }, [
    graphResult.data,
    arrangeNodes,
  ]);

  /**
   * ============================
   * 世界座標轉換
   * ============================
   */
  const screenToWorld =
    useCallback(
      (
        clientX: number,
        clientY: number
      ) => {
        const canvas =
          canvasRef.current;

        if (!canvas) {
          return {
            x: 0,
            y: 0,
          };
        }

        const rect =
          canvas.getBoundingClientRect();

        return {
          x:
            (
              clientX -
              rect.left -
              rect.width /
                2 -
              transformRef
                .current.x
            ) /
            transformRef
              .current.scale,

          y:
            (
              clientY -
              rect.top -
              rect.height /
                2 -
              transformRef
                .current.y
            ) /
            transformRef
              .current.scale,
        };
      },
      []
    );

  /**
   * ============================
   * 找滑鼠底下 Node
   * ============================
   */
  const findNodeAt =
    useCallback(
      (
        clientX: number,
        clientY: number
      ):
        | GraphNode
        | null => {
        const {
          x,
          y,
        } =
          screenToWorld(
            clientX,
            clientY
          );

        for (
          let index =
            graphData.nodes
              .length -
            1;
          index >= 0;
          index--
        ) {
          const node =
            graphData.nodes[
              index
            ];

          const radius =
            Math.max(
              14,
              node.radius +
                7
            );

          if (
            Math.hypot(
              node.x - x,
              node.y - y
            ) <= radius
          ) {
            return node;
          }
        }

        return null;
      },
      [
        graphData.nodes,
        screenToWorld,
      ]
    );

  /**
   * ============================
   * Canvas 繪圖
   * ============================
   */
  const draw =
    useCallback(() => {
      const canvas =
        canvasRef.current;

      const wrapper =
        wrapperRef.current;

      if (
        !canvas ||
        !wrapper
      ) {
        return;
      }

      const ctx =
        canvas.getContext(
          "2d"
        );

      if (!ctx) {
        return;
      }

      const rect =
        wrapper.getBoundingClientRect();

      const dpr =
        window.devicePixelRatio ||
        1;

      const width =
        rect.width;

      const height =
        rect.height;

      const targetWidth =
        Math.floor(
          width *
            dpr
        );

      const targetHeight =
        Math.floor(
          height *
            dpr
        );

      if (
        canvas.width !==
          targetWidth ||
        canvas.height !==
          targetHeight
      ) {
        canvas.width =
          targetWidth;

        canvas.height =
          targetHeight;

        canvas.style.width =
          `${width}px`;

        canvas.style.height =
          `${height}px`;
      }

      ctx.resetTransform();

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      ctx.scale(
        dpr,
        dpr
      );

      /**
       * ========================
       * 墨紙背景
       * ========================
       */
      const bg =
        ctx.createRadialGradient(
          width *
            0.45,
          height *
            0.38,
          20,

          width *
            0.5,
          height *
            0.5,
          Math.max(
            width,
            height
          )
        );

      bg.addColorStop(
        0,
        "#111416"
      );

      bg.addColorStop(
        0.52,
        "#0d0f11"
      );

      bg.addColorStop(
        1,
        "#090a0c"
      );

      ctx.fillStyle =
        bg;

      ctx.fillRect(
        0,
        0,
        width,
        height
      );

      /**
       * ========================
       * 紙張淡斑點
       * ========================
       */
      ctx.save();

      ctx.globalAlpha =
        0.11;

      for (
        let i = 0;
        i < 80;
        i++
      ) {
        const x =
          (
            Math.sin(
              i *
                72.17
            ) *
              0.5 +
            0.5
          ) *
          width;

        const y =
          (
            Math.cos(
              i *
                39.73
            ) *
              0.5 +
            0.5
          ) *
          height;

        ctx.beginPath();

        ctx.arc(
          x,
          y,
          i %
            5 ===
            0
            ? 1.1
            : 0.55,
          0,
          Math.PI *
            2
        );

        ctx.fillStyle =
          "rgba(221,217,207,.12)";

        ctx.fill();
      }

      ctx.restore();

      /**
       * ========================
       * 世界座標
       * ========================
       */
      ctx.save();

      ctx.translate(
        width /
          2 +
          transformRef
            .current.x,

        height /
          2 +
          transformRef
            .current.y
      );

      ctx.scale(
        transformRef
          .current.scale,

        transformRef
          .current.scale
      );

      const nodeMap =
        new Map(
          graphData.nodes.map(
            (node) => [
              node.id,
              node,
            ]
          )
        );

      const focusId =
        hoveredNodeId ||
        activeNoteId;

      const neighborIds =
        new Set<string>();

      if (focusId) {
        neighborIds.add(
          focusId
        );

        graphData.links.forEach(
          (link) => {
            if (
              link.source ===
              focusId
            ) {
              neighborIds.add(
                link.target
              );
            }

            if (
              link.target ===
              focusId
            ) {
              neighborIds.add(
                link.source
              );
            }
          }
        );
      }

      /**
       * ========================
       * 連線：細墨筆
       * ========================
       */
      graphData.links.forEach(
        (
          link,
          index
        ) => {
          const source =
            nodeMap.get(
              link.source
            );

          const target =
            nodeMap.get(
              link.target
            );

          if (
            !source ||
            !target
          ) {
            return;
          }

          const related =
            Boolean(
              focusId &&
              (
                link.source ===
                  focusId ||
                link.target ===
                  focusId
              )
            );

          ctx.save();

          ctx.beginPath();

          ctx.moveTo(
            source.x,
            source.y
          );

          /**
           * 輕微弧線，
           * 比直線更像筆觸。
           */
          const mx =
            (
              source.x +
              target.x
            ) /
            2;

          const my =
            (
              source.y +
              target.y
            ) /
            2;

          const curve =
            (
              index %
                2 ===
              0
                ? 1
                : -1
            ) *
            5;

          ctx.quadraticCurveTo(
            mx +
              curve,
            my -
              curve,
            target.x,
            target.y
          );

          ctx.strokeStyle =
            related
              ? "rgba(113,143,138,.58)"
              : focusId
              ? "rgba(220,216,207,.035)"
              : "rgba(220,216,207,.085)";

          ctx.lineWidth =
            related
              ? 1.05
              : 0.7;

          ctx.setLineDash(
            related
              ? [
                  16,
                  2,
                  4,
                  3,
                ]
              : [
                  21,
                  3,
                  2,
                  5,
                ]
          );

          ctx.stroke();

          ctx.restore();
        }
      );

      /**
       * ========================
       * Node 墨點
       * ========================
       */
      const query =
        filterQuery
          .trim()
          .toLowerCase();

      graphData.nodes.forEach(
        (node) => {
          const isActive =
            node.id ===
            activeNoteId;

          const isHovered =
            node.id ===
            hoveredNodeId;

          const isNeighbor =
            !focusId ||
            neighborIds.has(
              node.id
            );

          const isMatched =
            !query ||
            node.label
              .toLowerCase()
              .includes(
                query
              );

          let alpha =
            1;

          if (!isMatched) {
            alpha =
              0.12;
          } else if (
            !isNeighbor
          ) {
            alpha =
              0.26;
          }

          ctx.save();

          ctx.globalAlpha =
            alpha;

          const radius =
            Math.max(
              4.5,
              node.radius *
                0.56
            ) +
            (
              isHovered
                ? 1.5
                : 0
            );

          /**
           * Active Node 墨暈
           */
          if (isActive) {
            const wash =
              ctx.createRadialGradient(
                node.x,
                node.y,
                radius,

                node.x,
                node.y,
                radius +
                  16
              );

            wash.addColorStop(
              0,
              "rgba(163,72,61,.28)"
            );

            wash.addColorStop(
              1,
              "rgba(163,72,61,0)"
            );

            ctx.beginPath();

            ctx.arc(
              node.x,
              node.y,
              radius +
                16,
              0,
              Math.PI *
                2
            );

            ctx.fillStyle =
              wash;

            ctx.fill();
          }

          /**
           * Hover 黛青暈
           */
          if (
            isHovered &&
            !isActive
          ) {
            const wash =
              ctx.createRadialGradient(
                node.x,
                node.y,
                radius,

                node.x,
                node.y,
                radius +
                  14
              );

            wash.addColorStop(
              0,
              "rgba(113,143,138,.24)"
            );

            wash.addColorStop(
              1,
              "rgba(113,143,138,0)"
            );

            ctx.beginPath();

            ctx.arc(
              node.x,
              node.y,
              radius +
                14,
              0,
              Math.PI *
                2
            );

            ctx.fillStyle =
              wash;

            ctx.fill();
          }

          /**
           * 墨點本體
           */
          ctx.beginPath();

          ctx.arc(
            node.x,
            node.y,
            radius,
            0,
            Math.PI *
              2
          );

          if (
            node.type ===
            "unresolved"
          ) {
            ctx.fillStyle =
              "#796454";
          } else if (
            isActive
          ) {
            ctx.fillStyle =
              "#a3483d";
          } else if (
            isHovered
          ) {
            ctx.fillStyle =
              "#718f8a";
          } else {
            ctx.fillStyle =
              "#656964";
          }

          ctx.fill();

          /**
           * 第二層不完整墨邊
           */
          ctx.beginPath();

          ctx.arc(
            node.x +
              0.7,
            node.y -
              0.5,
            radius +
              1.5,
            Math.PI *
              0.15,
            Math.PI *
              1.55
          );

          ctx.strokeStyle =
            isActive
              ? "rgba(195,106,92,.55)"
              : isHovered
              ? "rgba(148,170,166,.5)"
              : "rgba(220,216,207,.14)";

          ctx.lineWidth =
            0.8;

          ctx.stroke();

          /**
           * ====================
           * Node Label
           * 無 Pill
           * ====================
           */
          const shouldShow =
            isActive ||
            isHovered ||
            graphData
              .nodes
              .length <=
              24;

          let label =
            node.label;

          if (
            !shouldShow &&
            label.length >
              9
          ) {
            label =
              label.slice(
                0,
                8
              ) +
              "…";
          }

          ctx.font =
            `${
              isActive
                ? 600
                : 500
            } ${
              isActive
                ? 13
                : 11
            }px "Noto Serif TC","PMingLiU",serif`;

          ctx.textAlign =
            "center";

          ctx.textBaseline =
            "top";

          ctx.fillStyle =
            isActive
              ? "#eeeae1"
              : isHovered
              ? "#ddd9d0"
              : "#969993";

          ctx.fillText(
            label,
            node.x,
            node.y +
              radius +
              8
          );

          ctx.restore();
        }
      );

      ctx.restore();
    }, [
      graphData,
      activeNoteId,
      hoveredNodeId,
      filterQuery,
      layoutVersion,
    ]);

  /**
   * Resize / redraw
   */
  useEffect(() => {
    draw();

    const handleResize =
      () => {
        draw();
      };

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, [draw]);

  /**
   * ============================
   * Mouse
   * ============================
   */
  const handleMouseDown = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const node =
      findNodeAt(
        e.clientX,
        e.clientY
      );

    dragRef.current = {
      mode: node
        ? "node"
        : "canvas",

      nodeId:
        node?.id ||
        null,

      lastX:
        e.clientX,

      lastY:
        e.clientY,

      downX:
        e.clientX,

      downY:
        e.clientY,

      moved: false,
    };
  };

  const handleMouseMove = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const drag =
      dragRef.current;

    if (
      drag.mode ===
      "node" &&
      drag.nodeId
    ) {
      const world =
        screenToWorld(
          e.clientX,
          e.clientY
        );

      const node =
        graphData.nodes.find(
          (item) =>
            item.id ===
            drag.nodeId
        );

      if (node) {
        node.x =
          world.x;

        node.y =
          world.y;

        drag.moved =
          true;

        setLayoutVersion(
          (version) =>
            version +
            1
        );
      }

      drag.lastX =
        e.clientX;

      drag.lastY =
        e.clientY;

      return;
    }

    if (
      drag.mode ===
      "canvas"
    ) {
      const dx =
        e.clientX -
        drag.lastX;

      const dy =
        e.clientY -
        drag.lastY;

      if (
        Math.hypot(
          e.clientX -
            drag.downX,

          e.clientY -
            drag.downY
        ) >
        4
      ) {
        drag.moved =
          true;
      }

      transformRef.current.x +=
        dx;

      transformRef.current.y +=
        dy;

      drag.lastX =
        e.clientX;

      drag.lastY =
        e.clientY;

      setLayoutVersion(
        (version) =>
          version + 1
      );

      return;
    }

    const node =
      findNodeAt(
        e.clientX,
        e.clientY
      );

    const nextId =
      node?.id ||
      null;

    if (
      nextId !==
      hoveredNodeId
    ) {
      setHoveredNodeId(
        nextId
      );
    }
  };

  const handleMouseUp = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const drag =
      dragRef.current;

    if (
      !drag.moved
    ) {
      const node =
        findNodeAt(
          e.clientX,
          e.clientY
        );

      if (
        node &&
        node.type ===
          "note"
      ) {
        onSelectNote(
          node.id
        );
      }
    }

    dragRef.current = {
      mode: "none",
      nodeId: null,

      lastX: 0,
      lastY: 0,

      downX: 0,
      downY: 0,

      moved: false,
    };
  };

  const handleMouseLeave =
    () => {
      setHoveredNodeId(
        null
      );

      dragRef.current = {
        ...dragRef.current,
        mode: "none",
        nodeId: null,
      };
    };

  /**
   * Zoom
   */
  const handleWheel = (
    e: React.WheelEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();

    const current =
      transformRef
        .current
        .scale;

    const factor =
      e.deltaY <
      0
        ? 1.1
        : 0.9;

    transformRef.current.scale =
      Math.max(
        0.28,
        Math.min(
          3,
          current *
            factor
        )
      );

    setLayoutVersion(
      (version) =>
        version + 1
    );
  };

  /**
   * Reset View
   */
  const resetView =
    () => {
      transformRef.current = {
        scale: 1,
        x: 0,
        y: 0,
      };

      setLayoutVersion(
        (version) =>
          version + 1
      );
    };

  /**
   * 重新排列
   */
  const rearrange =
    () => {
      setGraphData(
        arrangeNodes(
          graphData
        )
      );

      transformRef.current = {
        scale: 1,
        x: 0,
        y: 0,
      };

      setLayoutVersion(
        (version) =>
          version + 1
      );
    };

  return (
    <div
      className={`relative flex flex-col overflow-hidden bg-[#0a0c0e] text-[#d1cec6] ${
        isFullscreen
          ? "fixed inset-0 z-50"
          : "h-full w-full"
      }`}
    >
      {/* ========================
          Header
         ======================== */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.055] bg-[#101214]/94 px-5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-serif text-[13px] tracking-[0.08em] text-[#d7d3ca]">
            {graphMode ===
            "global"
              ? "全域圖譜"
              : "局部圖譜"}
          </span>

          <span className="font-mono text-[10px] text-[#666b67]">
            {
              graphData.nodes
                .length
            }
            {" "}
            節點
            {" · "}
            {
              graphData.links
                .length
            }
            {" "}
            關聯
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* 模式 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setGraphMode(
                  "global"
                )
              }
              className={`border-b pb-1 ${
                graphMode ===
                "global"
                  ? "border-[#718f8a] text-[#d8d5ce]"
                  : "border-transparent text-[#737772] hover:text-[#aaa9a3]"
              }`}
            >
              全域
            </button>

            <button
              type="button"
              disabled={
                !activeNoteId
              }
              onClick={() =>
                setGraphMode(
                  "local"
                )
              }
              className={`border-b pb-1 ${
                graphMode ===
                "local"
                  ? "border-[#718f8a] text-[#d8d5ce]"
                  : "border-transparent text-[#737772] hover:text-[#aaa9a3]"
              } disabled:opacity-30`}
            >
              局部
            </button>
          </div>

          <input
            type="text"
            value={
              filterQuery
            }
            onChange={(e) =>
              setFilterQuery(
                e.target.value
              )
            }
            placeholder="搜尋節點…"
            className="w-32 border-0 border-b border-white/[0.09] bg-transparent px-1 py-1 text-[11px] text-[#c9c6be] placeholder:text-[#525753] focus:border-[#718f8a] focus:outline-none"
          />

          <button
            type="button"
            onClick={
              rearrange
            }
            className="text-[11px] text-[#828680] hover:text-[#d6d3ca]"
          >
            重新排列
          </button>

          <button
            type="button"
            onClick={
              resetView
            }
            className="text-[11px] text-[#828680] hover:text-[#d6d3ca]"
          >
            重設視角
          </button>

          <button
            type="button"
            onClick={() =>
              setIsFullscreen(
                !isFullscreen
              )
            }
            className="text-[11px] text-[#828680] hover:text-[#d6d3ca]"
          >
            {isFullscreen
              ? "離開全螢幕"
              : "全螢幕"}
          </button>

          {onClose && (
            <button
              type="button"
              onClick={
                onClose
              }
              className="ml-1 text-[#98564c] hover:text-[#c87868]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 大型知識庫提醒 */}
      {graphResult.isCapped &&
        graphMode ===
          "global" && (
          <div className="border-b border-[#796454]/20 bg-[#796454]/8 px-5 py-2 text-[10px] text-[#a89482]">
            知識庫節點較多，已限制顯示前
            {" "}
            {maxNodesLimit}
            {" "}
            個節點以維持流暢度。
          </div>
        )}

      {/* ========================
          Canvas
         ======================== */}
      <div
        ref={
          wrapperRef
        }
        className={`relative flex-1 overflow-hidden ${
          hoveredNodeId
            ? "cursor-pointer"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <canvas
          ref={
            canvasRef
          }
          onMouseDown={
            handleMouseDown
          }
          onMouseMove={
            handleMouseMove
          }
          onMouseUp={
            handleMouseUp
          }
          onMouseLeave={
            handleMouseLeave
          }
          onWheel={
            handleWheel
          }
          className="absolute inset-0 block h-full w-full"
        />

        <div className="pointer-events-none absolute bottom-4 right-5 font-serif text-[10px] tracking-wide text-[#5d625e]">
          點選節點跳轉
          {" · "}
          拖曳移動
          {" · "}
          滾輪縮放
        </div>

        {/* 小朱砂印記 */}
        <div className="pointer-events-none absolute bottom-5 left-5 flex h-8 w-8 items-center justify-center border border-[#a3483d]/40 font-serif text-[10px] text-[#a3483d]/60">
          墨
        </div>
      </div>
    </div>
  );
}
