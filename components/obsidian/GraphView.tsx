"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
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
  notes: Array<Note | NoteMetadata>;
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}

interface DragState {
  draggedNodeId: string | null;
  isDraggingCanvas: boolean;
  startX: number;
  startY: number;
  downClientX: number;
  downClientY: number;
  hasMoved: boolean;
  pointerId: number | null;
}

interface PinchState {
  active: boolean;
  startDistance: number;
  startScale: number;
}

interface PointerPoint {
  x: number;
  y: number;
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function getDistance(
  a: PointerPoint,
  b: PointerPoint
): number {
  return Math.hypot(
    b.x - a.x,
    b.y - a.y
  );
}

export function GraphView({
  notes,
  activeNoteId,
  onSelectNote,
}: GraphViewProps) {
  const canvasRef =
    useRef<HTMLCanvasElement>(
      null
    );

  const canvasWrapperRef =
    useRef<HTMLDivElement>(
      null
    );

  const [
    graphMode,
    setGraphMode,
  ] =
    useState<
      "global" | "local"
    >(
      activeNoteId
        ? "local"
        : "global"
    );

  const [
    maxNodesLimit,
    setMaxNodesLimit,
  ] =
    useState(300);

  const [
    filterQuery,
    setFilterQuery,
  ] =
    useState("");

  const [
    hoveredNodeId,
    setHoveredNodeId,
  ] =
    useState<
      string | null
    >(null);

  const transformRef =
    useRef({
      scale: 1,
      x: 0,
      y: 0,
    });

  const simRef =
    useRef({
      alpha: 1,
      isSleeping: false,
      animationFrameId: 0,
      isRunning: true,
    });

  const dragRef =
    useRef<DragState>({
      draggedNodeId:
        null,

      isDraggingCanvas:
        false,

      startX: 0,
      startY: 0,

      downClientX: 0,
      downClientY: 0,

      hasMoved:
        false,

      pointerId:
        null,
    });

  const pointersRef =
    useRef<
      Map<
        number,
        PointerPoint
      >
    >(
      new Map()
    );

  const pinchRef =
    useRef<PinchState>({
      active: false,
      startDistance: 0,
      startScale: 1,
    });

  /*
   * 手機降低全域圖最大節點數，
   * 避免 300 nodes 的 O(n²) 排斥力讓手機掉幀。
   * Desktop 維持 300。
   */
  useEffect(() => {
    const updateLimit =
      () => {
        setMaxNodesLimit(
          window.innerWidth <=
            768
            ? 160
            : 300
        );
      };

    updateLimit();

    window.addEventListener(
      "resize",
      updateLimit
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateLimit
      );
    };
  }, []);

  const createGraphData =
    useCallback((): {
      data: GraphData;
      isCapped: boolean;
    } => {
      if (
        graphMode ===
          "local" &&
        activeNoteId
      ) {
        return {
          data:
            buildLocalGraphData(
              activeNoteId,
              notes
            ),

          isCapped: false,
        };
      }

      const result =
        buildGraphData(
          notes,
          maxNodesLimit
        ) as GraphData & {
          isCapped?: boolean;
        };

      return {
        data: {
          nodes:
            result.nodes,
          links:
            result.links,
        },

        isCapped:
          Boolean(
            result.isCapped
          ),
      };
    }, [
      notes,
      graphMode,
      activeNoteId,
      maxNodesLimit,
    ]);

  const initialResult =
    createGraphData();

  const [
    graphData,
    setGraphData,
  ] =
    useState<GraphData>(
      initialResult.data
    );

  const [
    isCapped,
    setIsCapped,
  ] =
    useState(
      initialResult.isCapped
    );

  const wakeUp =
    useCallback(
      (
        boostAlpha:
          number = 0.35
      ) => {
        simRef.current.alpha =
          Math.max(
            simRef.current.alpha,
            boostAlpha
          );

        simRef.current.isSleeping =
          false;
      },
      []
    );

  /*
   * Notes / 模式 / 節點上限變動時重建 Graph。
   * 舊節點保留目前位置，新節點從圓形分佈進場。
   */
  useEffect(() => {
    const result =
      createGraphData();

    setIsCapped(
      result.isCapped
    );

    setGraphData(
      (previous) => {
        const oldPosition =
          new Map(
            previous.nodes.map(
              (node) => [
                node.id,
                {
                  x: node.x,
                  y: node.y,
                },
              ]
            )
          );

        const nodes =
          result.data.nodes.map(
            (
              node,
              index
            ) => {
              const existing =
                oldPosition.get(
                  node.id
                );

              if (existing) {
                return {
                  ...node,
                  x:
                    existing.x,
                  y:
                    existing.y,
                };
              }

              if (
                result.data.nodes
                  .length ===
                  1 ||
                (
                  graphMode ===
                    "local" &&
                  node.id ===
                    activeNoteId
                )
              ) {
                return {
                  ...node,
                  x: 0,
                  y: 0,
                  vx: 0,
                  vy: 0,
                };
              }

              const angle =
                (
                  index /
                  Math.max(
                    1,
                    result.data
                      .nodes
                      .length
                  )
                ) *
                Math.PI *
                2;

              const distance =
                graphMode ===
                "local"
                  ? 115
                  : 140 +
                    (
                      index %
                      3
                    ) *
                    26;

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
            result.data.links,
        };
      }
    );

    wakeUp(0.95);
  }, [
    createGraphData,
    graphMode,
    activeNoteId,
    wakeUp,
  ]);

  /*
   * Canvas render loop + Force Physics。
   */
  useEffect(() => {
    const canvas =
      canvasRef.current;

    const wrapper =
      canvasWrapperRef.current;

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

    simRef.current.isRunning =
      true;

    const graphBackground =
      new Image();

    graphBackground.src =
      "/ink/graph-bg.png";

    graphBackground.onload =
      () => {
        wakeUp(0.08);
      };

    function resizeCanvas() {
      const currentCanvas =
        canvasRef.current;

      const currentWrapper =
        canvasWrapperRef.current;

      if (
        !currentCanvas ||
        !currentWrapper
      ) {
        return;
      }

      const rect =
        currentWrapper.getBoundingClientRect();

      /*
       * 手機 DPR 很容易到 3，
       * Canvas 面積會直接放大 9 倍。
       * 上限 2 對 Graph 已經足夠清楚。
       */
      const dpr =
        Math.min(
          window.devicePixelRatio ||
            1,
          2
        );

      currentCanvas.width =
        Math.max(
          1,
          Math.floor(
            rect.width *
              dpr
          )
        );

      currentCanvas.height =
        Math.max(
          1,
          Math.floor(
            rect.height *
              dpr
          )
        );

      currentCanvas.style.width =
        `${rect.width}px`;

      currentCanvas.style.height =
        `${rect.height}px`;

      wakeUp(0.12);
    }

    resizeCanvas();

    const resizeObserver =
      new ResizeObserver(
        resizeCanvas
      );

    resizeObserver.observe(
      wrapper
    );

    function stepPhysics() {
      if (
        simRef.current.alpha <
        0.001
      ) {
        simRef.current.isSleeping =
          true;

        return;
      }

      const nodes =
        graphData.nodes;

      const links =
        graphData.links;

      const indexMap =
        new Map(
          nodes.map(
            (
              node,
              index
            ) => [
              node.id,
              index,
            ]
          )
        );

      const isMobile =
        window.innerWidth <=
        768;

      const repulsion =
        graphMode ===
        "local"
          ? 2800
          : isMobile
          ? 1450
          : 1600;

      const springLength =
        graphMode ===
        "local"
          ? isMobile
            ? 155
            : 190
          : isMobile
          ? 108
          : 130;

      const springStrength =
        0.045;

      const centerGravity =
        0.015;

      const maxSpeed =
        isMobile
          ? 13
          : 16;

      /*
       * Repulsion
       */
      for (
        let i = 0;
        i < nodes.length;
        i++
      ) {
        const a =
          nodes[i];

        for (
          let j =
            i + 1;
          j <
          nodes.length;
          j++
        ) {
          const b =
            nodes[j];

          const dx =
            b.x - a.x;

          const dy =
            b.y - a.y;

          const distanceSquare =
            dx * dx +
            dy * dy ||
            1;

          if (
            distanceSquare >
            176400
          ) {
            continue;
          }

          const distance =
            Math.sqrt(
              distanceSquare
            );

          const force =
            (
              repulsion /
              (
                distanceSquare +
                200
              )
            ) *
            simRef.current
              .alpha;

          const fx =
            (
              dx /
              distance
            ) *
            force;

          const fy =
            (
              dy /
              distance
            ) *
            force;

          if (
            dragRef.current
              .draggedNodeId !==
            a.id
          ) {
            a.vx -= fx;
            a.vy -= fy;
          }

          if (
            dragRef.current
              .draggedNodeId !==
            b.id
          ) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }

      /*
       * Link spring
       */
      for (const link of links) {
        const sourceIndex =
          indexMap.get(
            link.source
          );

        const targetIndex =
          indexMap.get(
            link.target
          );

        if (
          sourceIndex ===
            undefined ||
          targetIndex ===
            undefined
        ) {
          continue;
        }

        const source =
          nodes[
            sourceIndex
          ];

        const target =
          nodes[
            targetIndex
          ];

        const dx =
          target.x -
          source.x;

        const dy =
          target.y -
          source.y;

        const distance =
          Math.sqrt(
            dx * dx +
              dy * dy
          ) ||
          1;

        const displacement =
          distance -
          springLength;

        const force =
          displacement *
          springStrength *
          simRef.current.alpha;

        const fx =
          (
            dx /
            distance
          ) *
          force;

        const fy =
          (
            dy /
            distance
          ) *
          force;

        if (
          dragRef.current
            .draggedNodeId !==
          source.id
        ) {
          source.vx += fx;
          source.vy += fy;
        }

        if (
          dragRef.current
            .draggedNodeId !==
          target.id
        ) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      let maxVelocity =
        0;

      /*
       * Center gravity + damping
       */
      for (const node of nodes) {
        if (
          dragRef.current
            .draggedNodeId ===
          node.id
        ) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.vx -=
          node.x *
          (
            centerGravity *
            1.5
          ) *
          simRef.current
            .alpha;

        node.vy -=
          node.y *
          (
            centerGravity *
            1.5
          ) *
          simRef.current
            .alpha;

        const speed =
          Math.sqrt(
            node.vx *
              node.vx +
            node.vy *
              node.vy
          );

        if (
          speed >
          maxSpeed
        ) {
          node.vx =
            (
              node.vx /
              speed
            ) *
            maxSpeed;

          node.vy =
            (
              node.vy /
              speed
            ) *
            maxSpeed;
        }

        node.vx *=
          0.88;

        node.vy *=
          0.88;

        node.x +=
          node.vx;

        node.y +=
          node.vy;

        maxVelocity =
          Math.max(
            maxVelocity,
            speed
          );
      }

      /*
       * Keep graph around origin
       */
      if (
        nodes.length >
          0 &&
        !dragRef.current
          .draggedNodeId
      ) {
        let sumX = 0;
        let sumY = 0;

        for (const node of nodes) {
          sumX += node.x;
          sumY += node.y;
        }

        const averageX =
          sumX /
          nodes.length;

        const averageY =
          sumY /
          nodes.length;

        for (const node of nodes) {
          node.x -=
            averageX *
            0.12;

          node.y -=
            averageY *
            0.12;
        }
      }

      simRef.current.alpha *=
        0.988;

      if (
        simRef.current.alpha <
          0.002 &&
        maxVelocity <
          0.05
      ) {
        simRef.current.isSleeping =
          true;
      }
    }

    /*
     * 物理系統睡眠後仍保留很小的墨點漂移。
     */
    function getAmbientPosition(
      node: GraphNode,
      time: number
    ) {
      let hash = 0;

      for (
        let i = 0;
        i < node.id.length;
        i++
      ) {
        hash =
          (
            hash *
              31 +
            node.id.charCodeAt(
              i
            )
          ) >>>
          0;
      }

      const phase =
        (
          hash %
          628
        ) /
        100;

      return {
        x:
          node.x +
          Math.sin(
            time *
              0.00042 +
              phase
          ) *
            1.55,

        y:
          node.y +
          Math.cos(
            time *
              0.00036 +
              phase *
                1.31
          ) *
            1.2,
      };
    }

    function render(
      time: number
    ) {
      const currentCanvas =
        canvasRef.current;

      if (
        !currentCanvas ||
        !ctx
      ) {
        return;
      }

      if (
        !simRef.current
          .isSleeping
      ) {
        stepPhysics();
      }

      const dpr =
        Math.min(
          window.devicePixelRatio ||
            1,
          2
        );

      const width =
        currentCanvas.width /
        dpr;

      const height =
        currentCanvas.height /
        dpr;

      ctx.save();

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      /*
       * Background
       */
      ctx.fillStyle =
        "#08090a";

      ctx.fillRect(
        0,
        0,
        width,
        height
      );

      if (
        graphBackground.complete &&
        graphBackground.naturalWidth >
          0 &&
        graphBackground.naturalHeight >
          0
      ) {
        const imageRatio =
          graphBackground.naturalWidth /
          graphBackground.naturalHeight;

        const canvasRatio =
          width /
          height;

        let drawWidth =
          width;

        let drawHeight =
          height;

        let drawX = 0;
        let drawY = 0;

        if (
          imageRatio >
          canvasRatio
        ) {
          drawHeight =
            height;

          drawWidth =
            height *
            imageRatio;

          drawX =
            (
              width -
              drawWidth
            ) /
            2;
        } else {
          drawWidth =
            width;

          drawHeight =
            width /
            imageRatio;

          drawY =
            (
              height -
              drawHeight
            ) /
            2;
        }

        ctx.save();

        ctx.globalAlpha =
          0.32;

        ctx.drawImage(
          graphBackground,
          drawX,
          drawY,
          drawWidth,
          drawHeight
        );

        ctx.restore();
      }

      /*
       * Sparse paper dust
       */
      ctx.save();

      ctx.globalAlpha =
        0.10;

      for (
        let i = 0;
        i < 54;
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
            6 ===
            0
            ? 1
            : 0.45,
          0,
          Math.PI *
            2
        );

        ctx.fillStyle =
          "rgba(226,220,207,.10)";

        ctx.fill();
      }

      ctx.restore();

      /*
       * World transform
       */
      ctx.translate(
        width /
          2 +
          transformRef.current
            .x,
        height /
          2 +
          transformRef.current
            .y
      );

      ctx.scale(
        transformRef.current
          .scale,
        transformRef.current
          .scale
      );

      const nodes =
        graphData.nodes;

      const links =
        graphData.links;

      const nodeMap =
        new Map(
          nodes.map(
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

        for (const link of links) {
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
      }

      /*
       * Links
       */
      links.forEach(
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

          const sourcePos =
            getAmbientPosition(
              source,
              time
            );

          const targetPos =
            getAmbientPosition(
              target,
              time
            );

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

          const middleX =
            (
              sourcePos.x +
              targetPos.x
            ) /
            2;

          const middleY =
            (
              sourcePos.y +
              targetPos.y
            ) /
            2;

          const bend =
            (
              index %
                2 ===
              0
                ? 1
                : -1
            ) *
            4;

          ctx.save();

          ctx.beginPath();

          ctx.moveTo(
            sourcePos.x,
            sourcePos.y
          );

          ctx.quadraticCurveTo(
            middleX +
              bend,
            middleY -
              bend,
            targetPos.x,
            targetPos.y
          );

          ctx.strokeStyle =
            related
              ? "rgba(112,143,137,.58)"
              : focusId
              ? "rgba(226,220,207,.035)"
              : "rgba(226,220,207,.085)";

          ctx.lineWidth =
            related
              ? 1.05
              : 0.72;

          ctx.setLineDash(
            related
              ? [
                  17,
                  2,
                  4,
                  3,
                ]
              : [
                  22,
                  3,
                  2,
                  5,
                ]
          );

          ctx.stroke();

          ctx.restore();
        }
      );

      const query =
        filterQuery
          .trim()
          .toLowerCase();

      /*
       * Nodes
       */
      for (const node of nodes) {
        const isActive =
          node.id ===
          activeNoteId;

        const isHovered =
          node.id ===
          hoveredNodeId;

        const isNeighbor =
          focusId
            ? neighborIds.has(
                node.id
              )
            : true;

        const isMatched =
          !query ||
          node.label
            .toLowerCase()
            .includes(
              query
            );

        const alpha =
          isMatched
            ? isNeighbor
              ? 1
              : 0.25
            : 0.13;

        const pos =
          getAmbientPosition(
            node,
            time
          );

        ctx.save();

        ctx.globalAlpha =
          alpha;

        const radius =
          Math.max(
            5,
            node.radius *
              0.7
          ) +
          (
            isHovered
              ? 1.7
              : 0
          );

        /*
         * Active cinnabar wash
         */
        if (isActive) {
          const pulse =
            1 +
            Math.sin(
              time *
                0.0022
            ) *
              0.08;

          const wash =
            ctx.createRadialGradient(
              pos.x,
              pos.y,
              radius,

              pos.x,
              pos.y,
              (
                radius +
                15
              ) *
                pulse
            );

          wash.addColorStop(
            0,
            "rgba(163,75,64,.26)"
          );

          wash.addColorStop(
            1,
            "rgba(163,75,64,0)"
          );

          ctx.beginPath();

          ctx.arc(
            pos.x,
            pos.y,
            (
              radius +
              15
            ) *
              pulse,
            0,
            Math.PI *
              2
          );

          ctx.fillStyle =
            wash;

          ctx.fill();
        }

        /*
         * Hover jade wash
         */
        if (
          isHovered &&
          !isActive
        ) {
          const wash =
            ctx.createRadialGradient(
              pos.x,
              pos.y,
              radius,

              pos.x,
              pos.y,
              radius +
                13
            );

          wash.addColorStop(
            0,
            "rgba(112,143,137,.24)"
          );

          wash.addColorStop(
            1,
            "rgba(112,143,137,0)"
          );

          ctx.beginPath();

          ctx.arc(
            pos.x,
            pos.y,
            radius +
              13,
            0,
            Math.PI *
              2
          );

          ctx.fillStyle =
            wash;

          ctx.fill();
        }

        ctx.beginPath();

        ctx.arc(
          pos.x,
          pos.y,
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
            "#a34b40";
        } else if (
          isHovered
        ) {
          ctx.fillStyle =
            "#708f89";
        } else {
          ctx.fillStyle =
            "#656963";
        }

        ctx.fill();

        /*
         * Broken ink edge
         */
        ctx.beginPath();

        ctx.arc(
          pos.x +
            0.7,
          pos.y -
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
            ? "rgba(195,108,94,.55)"
            : isHovered
            ? "rgba(154,177,172,.5)"
            : "rgba(226,220,207,.14)";

        ctx.lineWidth =
          0.8;

        ctx.stroke();

        /*
         * Label
         */
        const showFullText =
          isHovered ||
          isActive ||
          nodes.length <=
            18;

        let label =
          node.label;

        if (
          !showFullText &&
          label.length >
            10
        ) {
          label =
            label.slice(
              0,
              9
            ) +
            "…";
        }

        const fontSize =
          isActive
            ? 13
            : 11;

        ctx.font =
          `${isActive ? 600 : 500} ${fontSize}px ` +
          `"Noto Serif TC","PMingLiU","STSong",serif`;

        ctx.textAlign =
          "center";

        ctx.textBaseline =
          "top";

        ctx.fillStyle =
          isActive
            ? "#f0ece2"
            : isHovered
            ? "#ded9cf"
            : "#959891";

        ctx.fillText(
          label,
          pos.x,
          pos.y +
            radius +
            8
        );

        ctx.restore();
      }

      ctx.restore();

      if (
        simRef.current
          .isRunning
      ) {
        simRef.current.animationFrameId =
          requestAnimationFrame(
            render
          );
      }
    }

    simRef.current.animationFrameId =
      requestAnimationFrame(
        render
      );

    return () => {
      simRef.current.isRunning =
        false;

      cancelAnimationFrame(
        simRef.current
          .animationFrameId
      );

      resizeObserver.disconnect();
    };
  }, [
    graphData,
    filterQuery,
    activeNoteId,
    graphMode,
    hoveredNodeId,
    wakeUp,
  ]);

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

  const findNodeUnder =
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
              18,
              node.radius +
                10
            );

          if (
            Math.hypot(
              node.x - x,
              node.y - y
            ) <= radius
          ) {
            return node;
          }

          /*
           * 文字區也可以點。
           */
          const label =
            node.label.length >
              10
              ? node.label.slice(
                  0,
                  9
                ) +
                "…"
              : node.label;

          const charWidth =
            /[\u4e00-\u9fa5]/.test(
              label
            )
              ? 12
              : 7.5;

          const textWidth =
            label.length *
              charWidth +
            12;

          const labelTop =
            node.y +
            Math.max(
              5,
              node.radius *
                0.7
            ) +
            5;

          if (
            x >=
              node.x -
                textWidth /
                  2 &&
            x <=
              node.x +
                textWidth /
                  2 &&
            y >=
              labelTop &&
            y <=
              labelTop +
                26
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

  function resetDragState() {
    dragRef.current = {
      draggedNodeId:
        null,

      isDraggingCanvas:
        false,

      startX: 0,
      startY: 0,

      downClientX: 0,
      downClientY: 0,

      hasMoved:
        false,

      pointerId:
        null,
    };
  }

  /*
   * Pointer API：
   * Mouse / Pen / Touch 共用。
   */
  const handlePointerDown =
    (
      event:
        ReactPointerEvent<HTMLCanvasElement>
    ) => {
      const canvas =
        event.currentTarget;

      try {
        canvas.setPointerCapture(
          event.pointerId
        );
      } catch {
        // ignore
      }

      pointersRef.current.set(
        event.pointerId,
        {
          x:
            event.clientX,
          y:
            event.clientY,
        }
      );

      /*
       * 第二根手指加入 -> Pinch mode
       */
      if (
        pointersRef.current
          .size >=
        2
      ) {
        const points =
          Array.from(
            pointersRef.current.values()
          );

        pinchRef.current = {
          active: true,

          startDistance:
            Math.max(
              1,
              getDistance(
                points[0],
                points[1]
              )
            ),

          startScale:
            transformRef.current
              .scale,
        };

        resetDragState();

        wakeUp(0.12);

        return;
      }

      const node =
        findNodeUnder(
          event.clientX,
          event.clientY
        );

      dragRef.current = {
        draggedNodeId:
          node?.id ||
          null,

        isDraggingCanvas:
          !node,

        startX:
          event.clientX,

        startY:
          event.clientY,

        downClientX:
          event.clientX,

        downClientY:
          event.clientY,

        hasMoved:
          false,

        pointerId:
          event.pointerId,
      };

      wakeUp(0.35);
    };

  const handlePointerMove =
    (
      event:
        ReactPointerEvent<HTMLCanvasElement>
    ) => {
      if (
        pointersRef.current.has(
          event.pointerId
        )
      ) {
        pointersRef.current.set(
          event.pointerId,
          {
            x:
              event.clientX,
            y:
              event.clientY,
          }
        );
      }

      /*
       * Pinch Zoom
       */
      if (
        pinchRef.current
          .active &&
        pointersRef.current
          .size >=
          2
      ) {
        const points =
          Array.from(
            pointersRef.current.values()
          );

        const distance =
          Math.max(
            1,
            getDistance(
              points[0],
              points[1]
            )
          );

        const ratio =
          distance /
          pinchRef.current
            .startDistance;

        transformRef.current.scale =
          clamp(
            pinchRef.current
              .startScale *
              ratio,
            0.18,
            3.5
          );

        wakeUp(0.08);

        return;
      }

      const drag =
        dragRef.current;

      if (
        drag.pointerId !==
          event.pointerId
      ) {
        /*
         * Mouse 沒有按下時，
         * 仍允許 Hover。
         */
        if (
          event.pointerType ===
            "mouse" &&
          event.buttons ===
            0
        ) {
          const hover =
            findNodeUnder(
              event.clientX,
              event.clientY
            );

          setHoveredNodeId(
            hover?.id ||
              null
          );
        }

        return;
      }

      const totalDistance =
        Math.hypot(
          event.clientX -
            drag.downClientX,

          event.clientY -
            drag.downClientY
        );

      if (
        totalDistance >
        5
      ) {
        drag.hasMoved =
          true;
      }

      if (
        drag.draggedNodeId
      ) {
        const {
          x,
          y,
        } =
          screenToWorld(
            event.clientX,
            event.clientY
          );

        const node =
          graphData.nodes.find(
            (item) =>
              item.id ===
              drag.draggedNodeId
          );

        if (node) {
          node.x = x;
          node.y = y;

          node.vx =
            (
              event.clientX -
              drag.startX
            ) *
            0.35;

          node.vy =
            (
              event.clientY -
              drag.startY
            ) *
            0.35;
        }

        drag.startX =
          event.clientX;

        drag.startY =
          event.clientY;

        wakeUp(0.42);

        return;
      }

      if (
        drag.isDraggingCanvas
      ) {
        const dx =
          event.clientX -
          drag.startX;

        const dy =
          event.clientY -
          drag.startY;

        transformRef.current.x +=
          dx;

        transformRef.current.y +=
          dy;

        drag.startX =
          event.clientX;

        drag.startY =
          event.clientY;

        wakeUp(0.06);

        return;
      }

      if (
        event.pointerType ===
        "mouse"
      ) {
        const hover =
          findNodeUnder(
            event.clientX,
            event.clientY
          );

        setHoveredNodeId(
          hover?.id ||
            null
        );
      }
    };

  const finishPointer =
    (
      event:
        ReactPointerEvent<HTMLCanvasElement>
    ) => {
      const wasPinching =
        pinchRef.current
          .active;

      const drag =
        dragRef.current;

      pointersRef.current.delete(
        event.pointerId
      );

      try {
        event.currentTarget.releasePointerCapture(
          event.pointerId
        );
      } catch {
        // ignore
      }

      /*
       * Pinch 結束後不觸發節點 click。
       */
      if (wasPinching) {
        if (
          pointersRef.current
            .size <
          2
        ) {
          pinchRef.current = {
            active: false,
            startDistance: 0,
            startScale:
              transformRef.current
                .scale,
          };
        }

        resetDragState();

        return;
      }

      if (
        drag.pointerId !==
        event.pointerId
      ) {
        return;
      }

      const totalDistance =
        Math.hypot(
          event.clientX -
            drag.downClientX,

          event.clientY -
            drag.downClientY
        );

      if (
        !drag.hasMoved ||
        totalDistance <=
          6
      ) {
        const node =
          findNodeUnder(
            event.clientX,
            event.clientY
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
      } else if (
        drag.draggedNodeId
      ) {
        wakeUp(0.3);
      }

      resetDragState();
    };

  const handlePointerCancel =
    (
      event:
        ReactPointerEvent<HTMLCanvasElement>
    ) => {
      pointersRef.current.delete(
        event.pointerId
      );

      pinchRef.current.active =
        false;

      resetDragState();
    };

  const handlePointerLeave =
    (
      event:
        ReactPointerEvent<HTMLCanvasElement>
    ) => {
      if (
        event.pointerType ===
        "mouse" &&
        event.buttons ===
          0
      ) {
        setHoveredNodeId(
          null
        );
      }
    };

  const handleWheel =
    (
      event:
        ReactWheelEvent<HTMLCanvasElement>
    ) => {
      event.preventDefault();

      const zoomFactor =
        event.deltaY <
        0
          ? 1.12
          : 0.88;

      transformRef.current.scale =
        clamp(
          transformRef.current
            .scale *
            zoomFactor,
          0.15,
          3.5
        );

      wakeUp(0.12);
    };

  const handleJiggle =
    () => {
      for (
        const node of
        graphData.nodes
      ) {
        node.vx +=
          (
            Math.random() -
            0.5
          ) *
          8;

        node.vy +=
          (
            Math.random() -
            0.5
          ) *
          8;
      }

      wakeUp(1);
    };

  const resetView =
    () => {
      transformRef.current = {
        scale: 1,
        x: 0,
        y: 0,
      };

      wakeUp(0.8);
    };

  return (
    <div className="graph-view-root relative flex h-full w-full flex-col overflow-hidden bg-[#090b0c] text-[#d1cdc4] select-none">
      <div className="graph-view-header relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.055] bg-[#101213]/94 px-5 py-2.5 backdrop-blur-md">
        <div className="graph-title-row flex items-center gap-4">
          <span className="font-serif text-[13px] tracking-[0.08em] text-[#d8d4ca]">
            {graphMode ===
            "global"
              ? "全域圖譜"
              : "局部圖譜"}
          </span>

          <span className="font-mono text-[10px] text-[#676b67]">
            {
              graphData.nodes
                .length
            }
            {" 節點 · "}
            {
              graphData.links
                .length
            }
            {" 關聯"}
          </span>
        </div>

        <div className="graph-controls flex flex-wrap items-center gap-3 text-xs">
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setGraphMode(
                  "global"
                );

                wakeUp(0.9);
              }}
              className={`border-b pb-1 ${
                graphMode ===
                "global"
                  ? "border-[#708f89] text-[#dad6cc]"
                  : "border-transparent text-[#767a75] hover:text-[#aaa8a0]"
              }`}
            >
              全域
            </button>

            <button
              type="button"
              disabled={
                !activeNoteId
              }
              onClick={() => {
                setGraphMode(
                  "local"
                );

                wakeUp(0.9);
              }}
              className={`border-b pb-1 ${
                graphMode ===
                "local"
                  ? "border-[#708f89] text-[#dad6cc]"
                  : "border-transparent text-[#767a75] hover:text-[#aaa8a0]"
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
            onChange={(
              event
            ) => {
              setFilterQuery(
                event.target
                  .value
              );

              wakeUp(0.2);
            }}
            placeholder="搜尋節點…"
            className="graph-search w-32 border-0 border-b border-white/[0.09] bg-transparent px-1 py-1 text-[11px] text-[#c8c5bd] placeholder:text-[#535753] focus:border-[#708f89] focus:outline-none"
          />

          <button
            type="button"
            onClick={
              handleJiggle
            }
            className="shrink-0 text-[11px] text-[#838780] hover:text-[#d6d2c8]"
            title="重新加入物理動能"
          >
            重新舒展
          </button>

          <button
            type="button"
            onClick={
              resetView
            }
            className="shrink-0 text-[11px] text-[#838780] hover:text-[#d6d2c8]"
          >
            重設視角
          </button>
        </div>
      </div>

      {isCapped &&
        graphMode ===
          "global" && (
          <div className="border-b border-[#796454]/20 bg-[#796454]/8 px-5 py-2 text-[10px] text-[#aa9683]">
            知識庫節點較多，目前裝置顯示前{" "}
            {maxNodesLimit}{" "}
            個節點以維持流暢度。
          </div>
        )}

      <div
        ref={
          canvasWrapperRef
        }
        className={`relative min-h-0 flex-1 overflow-hidden ${
          hoveredNodeId
            ? "cursor-pointer"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <canvas
          ref={
            canvasRef
          }
          onPointerDown={
            handlePointerDown
          }
          onPointerMove={
            handlePointerMove
          }
          onPointerUp={
            finishPointer
          }
          onPointerCancel={
            handlePointerCancel
          }
          onPointerLeave={
            handlePointerLeave
          }
          onWheel={
            handleWheel
          }
          className="graph-canvas absolute inset-0 block h-full w-full touch-none"
        />

        <div className="graph-hint-desktop pointer-events-none absolute bottom-4 right-5 font-serif text-[10px] tracking-wide text-[#5d625d]">
          點選跳轉 · 拖曳節點 · 拖曳畫布 · 滾輪縮放
        </div>

        <div className="graph-hint-mobile pointer-events-none absolute bottom-4 right-5 hidden font-serif text-[10px] tracking-wide text-[#5d625d]">
          點選跳轉 · 單指拖曳 · 雙指縮放
        </div>

        <div className="graph-ink-seal pointer-events-none absolute bottom-5 left-5 flex h-8 w-8 items-center justify-center border border-[#a34b40]/40 font-serif text-[10px] text-[#a34b40]/60">
          墨
        </div>
      </div>
    </div>
  );
}
