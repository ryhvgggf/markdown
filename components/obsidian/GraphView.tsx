"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { buildGraphData, buildLocalGraphData } from "@/lib/obsidian/links";
import { GraphData, GraphNode, Note, NoteMetadata } from "@/lib/obsidian/types";

interface GraphViewProps {
  notes: Array<Note | NoteMetadata>;
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}

export function GraphView({
  notes,
  activeNoteId,
  onSelectNote,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const [graphMode, setGraphMode] = useState<"global" | "local">(
    activeNoteId ? "local" : "global"
  );
  const [maxNodesLimit] = useState<number>(300);
  const [filterQuery, setFilterQuery] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const transformRef = useRef({
    scale: 1,
    x: 0,
    y: 0,
  });

  const simRef = useRef({
    alpha: 1.0,
    isSleeping: false,
    animFrameId: 0,
    isRunning: true,
  });

  const dragRef = useRef<{
    isDraggingCanvas: boolean;
    draggedNodeId: string | null;
    startX: number;
    startY: number;
    downClientX: number;
    downClientY: number;
    hasMoved: boolean;
  }>({
    isDraggingCanvas: false,
    draggedNodeId: null,
    startX: 0,
    startY: 0,
    downClientX: 0,
    downClientY: 0,
    hasMoved: false,
  });

  const [graphData, setGraphData] = useState<GraphData>(() => {
    if (activeNoteId) {
      return buildLocalGraphData(activeNoteId, notes);
    }

    const result = buildGraphData(notes, maxNodesLimit);

    return {
      nodes: result.nodes,
      links: result.links,
    };
  });

  const [isCapped, setIsCapped] = useState(
    graphMode === "global" && notes.length > maxNodesLimit
  );

  const wakeUp = useCallback((boostAlpha: number = 0.35) => {
    simRef.current.alpha = Math.max(simRef.current.alpha, boostAlpha);
    simRef.current.isSleeping = false;
  }, []);

  useEffect(() => {
    let data: GraphData;
    let capped = false;

    if (graphMode === "local" && activeNoteId) {
      data = buildLocalGraphData(activeNoteId, notes);
    } else {
      const result = buildGraphData(notes, maxNodesLimit);
      data = {
        nodes: result.nodes,
        links: result.links,
      };
      capped = Boolean(result.isCapped);
    }

    setIsCapped(capped);

    setGraphData((previous) => {
      const previousPosition = new Map(
        previous.nodes.map((node) => [
          node.id,
          {
            x: node.x,
            y: node.y,
          },
        ])
      );

      const newNodes = data.nodes.map((node, index) => {
        const existing = previousPosition.get(node.id);

        if (existing) {
          return {
            ...node,
            x: existing.x,
            y: existing.y,
          };
        }

        if (
          data.nodes.length === 1 ||
          (graphMode === "local" && node.id === activeNoteId)
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
          (index / Math.max(1, data.nodes.length)) * Math.PI * 2;

        const distance =
          graphMode === "local"
            ? 120
            : 140 + (index % 3) * 30;

        return {
          ...node,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          vx: 0,
          vy: 0,
        };
      });

      return {
        nodes: newNodes,
        links: data.links,
      };
    });

    wakeUp(0.95);
  }, [notes, graphMode, activeNoteId, maxNodesLimit, wakeUp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;

    if (!canvas || !wrapper) {
      return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    simRef.current.isRunning = true;

    function resizeCanvas() {
      if (!canvas || !canvasWrapperRef.current) {
        return;
      }

      const rect = canvasWrapperRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      wakeUp(0.12);
    }

    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });

    resizeObserver.observe(wrapper);

    /*
     * Graph 背景圖片。
     * 只調整視覺，不影響 Force Physics、拖曳、縮放與節點互動。
     */
    const graphBackground = new Image();
    graphBackground.src = "/ink/graph-bg.png";
    graphBackground.onload = () => {
      wakeUp(0.08);
    };

    function stepPhysics() {
      if (simRef.current.alpha < 0.001) {
        simRef.current.isSleeping = true;
        return;
      }

      const nodes = graphData.nodes;
      const links = graphData.links;
      const nodeIndexMap = new Map(nodes.map((node, index) => [node.id, index]));

      const repulsion = graphMode === "local" ? 2800 : 1600;
      const springLength = graphMode === "local" ? 190 : 130;
      const springStrength = 0.045;
      const centerGravity = 0.015;
      const maxSpeed = 16;

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];

          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy || 1;

          if (distSq < 176400) {
            const dist = Math.sqrt(distSq);
            const force =
              (repulsion / (distSq + 200)) * simRef.current.alpha;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (dragRef.current.draggedNodeId !== n1.id) {
              n1.vx -= fx;
              n1.vy -= fy;
            }

            if (dragRef.current.draggedNodeId !== n2.id) {
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }
      }

      for (const link of links) {
        const sourceIndex = nodeIndexMap.get(link.source);
        const targetIndex = nodeIndexMap.get(link.target);

        if (sourceIndex === undefined || targetIndex === undefined) {
          continue;
        }

        const source = nodes[sourceIndex];
        const target = nodes[targetIndex];

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const displacement = dist - springLength;
        const force =
          displacement * springStrength * simRef.current.alpha;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (dragRef.current.draggedNodeId !== source.id) {
          source.vx += fx;
          source.vy += fy;
        }

        if (dragRef.current.draggedNodeId !== target.id) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      let maxVelocity = 0;

      for (const node of nodes) {
        if (dragRef.current.draggedNodeId === node.id) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.vx -= node.x * (centerGravity * 1.5) * simRef.current.alpha;
        node.vy -= node.y * (centerGravity * 1.5) * simRef.current.alpha;

        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);

        if (speed > maxSpeed) {
          node.vx = (node.vx / speed) * maxSpeed;
          node.vy = (node.vy / speed) * maxSpeed;
        }

        node.vx *= 0.88;
        node.vy *= 0.88;

        node.x += node.vx;
        node.y += node.vy;

        maxVelocity = Math.max(maxVelocity, speed);
      }

      if (nodes.length > 0 && !dragRef.current.draggedNodeId) {
        let sumX = 0;
        let sumY = 0;

        for (const node of nodes) {
          sumX += node.x;
          sumY += node.y;
        }

        const avgX = sumX / nodes.length;
        const avgY = sumY / nodes.length;

        for (const node of nodes) {
          node.x -= avgX * 0.12;
          node.y -= avgY * 0.12;
        }
      }

      simRef.current.alpha *= 0.988;

      if (simRef.current.alpha < 0.002 && maxVelocity < 0.05) {
        simRef.current.isSleeping = true;
      }
    }

    function getAmbientPosition(node: GraphNode, time: number) {
      let hash = 0;

      for (let i = 0; i < node.id.length; i++) {
        hash = (hash * 31 + node.id.charCodeAt(i)) >>> 0;
      }

      const phase = (hash % 628) / 100;

      return {
        x: node.x + Math.sin(time * 0.00042 + phase) * 1.6,
        y: node.y + Math.cos(time * 0.00036 + phase * 1.31) * 1.25,
      };
    }

    function render(time: number) {
      if (!ctx || !canvas) {
        return;
      }

      if (!simRef.current.isSleeping) {
        stepPhysics();
      }

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);

      /*
       * Graph 背景：
       * 使用 public/ink/graph-bg.png。
       * 透明度 0.32，與右側梅花背景的 opacity 調法一致。
       */
      ctx.fillStyle = "#08090a";
      ctx.fillRect(0, 0, width, height);

      if (
        graphBackground.complete &&
        graphBackground.naturalWidth > 0 &&
        graphBackground.naturalHeight > 0
      ) {
        const imageRatio =
          graphBackground.naturalWidth /
          graphBackground.naturalHeight;

        const canvasRatio =
          width / height;

        let drawWidth = width;
        let drawHeight = height;
        let drawX = 0;
        let drawY = 0;

        if (imageRatio > canvasRatio) {
          drawHeight = height;
          drawWidth =
            height * imageRatio;
          drawX =
            (width - drawWidth) / 2;
        } else {
          drawWidth = width;
          drawHeight =
            width / imageRatio;
          drawY =
            (height - drawHeight) / 2;
        }

        ctx.save();

        /*
         * 與右側梅花一致：
         * 梅花 CSS opacity = 0.32
         * Graph Canvas globalAlpha = 0.32
         */
        ctx.globalAlpha = 0.32;

        ctx.drawImage(
          graphBackground,
          drawX,
          drawY,
          drawWidth,
          drawHeight
        );

        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = 0.11;

      for (let i = 0; i < 70; i++) {
        const x =
          (Math.sin(i * 72.17) * 0.5 + 0.5) * width;

        const y =
          (Math.cos(i * 39.73) * 0.5 + 0.5) * height;

        ctx.beginPath();
        ctx.arc(
          x,
          y,
          i % 6 === 0 ? 1.05 : 0.5,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = "rgba(226,220,207,.11)";
        ctx.fill();
      }

      ctx.restore();

      ctx.translate(
        width / 2 + transformRef.current.x,
        height / 2 + transformRef.current.y
      );

      ctx.scale(
        transformRef.current.scale,
        transformRef.current.scale
      );

      const nodes = graphData.nodes;
      const links = graphData.links;
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));

      const activeOrHoverId = hoveredNodeId || activeNoteId;
      const neighborIds = new Set<string>();

      if (activeOrHoverId) {
        neighborIds.add(activeOrHoverId);

        for (const link of links) {
          if (link.source === activeOrHoverId) {
            neighborIds.add(link.target);
          }

          if (link.target === activeOrHoverId) {
            neighborIds.add(link.source);
          }
        }
      }

      links.forEach((link, index) => {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);

        if (!source || !target) {
          return;
        }

        const sourcePos = getAmbientPosition(source, time);
        const targetPos = getAmbientPosition(target, time);

        const related =
          Boolean(
            activeOrHoverId &&
            (link.source === activeOrHoverId ||
              link.target === activeOrHoverId)
          );

        const middleX = (sourcePos.x + targetPos.x) / 2;
        const middleY = (sourcePos.y + targetPos.y) / 2;
        const bend = (index % 2 === 0 ? 1 : -1) * 4;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sourcePos.x, sourcePos.y);
        ctx.quadraticCurveTo(
          middleX + bend,
          middleY - bend,
          targetPos.x,
          targetPos.y
        );

        ctx.strokeStyle = related
          ? "rgba(112,143,137,.58)"
          : activeOrHoverId
          ? "rgba(226,220,207,.035)"
          : "rgba(226,220,207,.085)";

        ctx.lineWidth = related ? 1.05 : 0.72;

        ctx.setLineDash(
          related
            ? [17, 2, 4, 3]
            : [22, 3, 2, 5]
        );

        ctx.stroke();
        ctx.restore();
      });

      const query = filterQuery.toLowerCase().trim();

      for (const node of nodes) {
        const isActive = node.id === activeNoteId;
        const isHovered = node.id === hoveredNodeId;

        const isNeighbor = activeOrHoverId
          ? neighborIds.has(node.id)
          : true;

        const isMatched =
          !query || node.label.toLowerCase().includes(query);

        const alpha = isMatched
          ? isNeighbor
            ? 1
            : 0.25
          : 0.13;

        const pos = getAmbientPosition(node, time);

        ctx.save();
        ctx.globalAlpha = alpha;

        const radius =
          Math.max(5, node.radius * 0.7) +
          (isHovered ? 1.7 : 0);

        if (isActive) {
          const pulse =
            1 + Math.sin(time * 0.0022) * 0.08;

          const wash = ctx.createRadialGradient(
            pos.x,
            pos.y,
            radius,
            pos.x,
            pos.y,
            (radius + 15) * pulse
          );

          wash.addColorStop(0, "rgba(163,75,64,.26)");
          wash.addColorStop(1, "rgba(163,75,64,0)");

          ctx.beginPath();
          ctx.arc(
            pos.x,
            pos.y,
            (radius + 15) * pulse,
            0,
            Math.PI * 2
          );
          ctx.fillStyle = wash;
          ctx.fill();
        }

        if (isHovered && !isActive) {
          const wash = ctx.createRadialGradient(
            pos.x,
            pos.y,
            radius,
            pos.x,
            pos.y,
            radius + 13
          );

          wash.addColorStop(0, "rgba(112,143,137,.24)");
          wash.addColorStop(1, "rgba(112,143,137,0)");

          ctx.beginPath();
          ctx.arc(
            pos.x,
            pos.y,
            radius + 13,
            0,
            Math.PI * 2
          );
          ctx.fillStyle = wash;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(
          pos.x,
          pos.y,
          radius,
          0,
          Math.PI * 2
        );

        if (node.type === "unresolved") {
          ctx.fillStyle = "#796454";
        } else if (isActive) {
          ctx.fillStyle = "#a34b40";
        } else if (isHovered) {
          ctx.fillStyle = "#708f89";
        } else {
          ctx.fillStyle = "#656963";
        }

        ctx.fill();

        ctx.beginPath();
        ctx.arc(
          pos.x + 0.7,
          pos.y - 0.5,
          radius + 1.5,
          Math.PI * 0.15,
          Math.PI * 1.55
        );

        ctx.strokeStyle = isActive
          ? "rgba(195,108,94,.55)"
          : isHovered
          ? "rgba(154,177,172,.5)"
          : "rgba(226,220,207,.14)";

        ctx.lineWidth = 0.8;
        ctx.stroke();

        const showFullText =
          isHovered ||
          isActive ||
          graphData.nodes.length <= 18;

        let label = node.label;

        if (!showFullText && label.length > 10) {
          label = label.slice(0, 9) + "…";
        }

        const fontSize = isActive ? 13 : 11;

        ctx.font =
          `${isActive ? 600 : 500} ${fontSize}px ` +
          `"Noto Serif TC","PMingLiU","STSong",serif`;

        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        ctx.fillStyle = isActive
          ? "#f0ece2"
          : isHovered
          ? "#ded9cf"
          : "#959891";

        ctx.fillText(
          label,
          pos.x,
          pos.y + radius + 8
        );

        ctx.restore();
      }

      ctx.restore();

      if (simRef.current.isRunning) {
        simRef.current.animFrameId =
          requestAnimationFrame(render);
      }
    }

    simRef.current.animFrameId =
      requestAnimationFrame(render);

    return () => {
      simRef.current.isRunning = false;
      cancelAnimationFrame(simRef.current.animFrameId);
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

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return {
          x: 0,
          y: 0,
        };
      }

      const rect = canvas.getBoundingClientRect();

      const mouseXInCanvas = clientX - rect.left;
      const mouseYInCanvas = clientY - rect.top;

      return {
        x:
          (mouseXInCanvas -
            rect.width / 2 -
            transformRef.current.x) /
          transformRef.current.scale,

        y:
          (mouseYInCanvas -
            rect.height / 2 -
            transformRef.current.y) /
          transformRef.current.scale,
      };
    },
    []
  );

  const findNodeUnder = useCallback(
    (
      clientX: number,
      clientY: number
    ): GraphNode | null => {
      const { x, y } =
        screenToWorld(clientX, clientY);

      for (const node of graphData.nodes) {
        const dx = node.x - x;
        const dy = node.y - y;
        const distance = Math.hypot(dx, dy);

        const hitRadius =
          Math.max(17, node.radius + 9);

        if (distance <= hitRadius) {
          return node;
        }

        const full =
          node.id === hoveredNodeId ||
          node.id === activeNoteId ||
          graphData.nodes.length <= 18;

        let label = node.label;

        if (!full && label.length > 10) {
          label = label.slice(0, 9) + "…";
        }

        const charWidth =
          /[\u4e00-\u9fa5]/.test(label)
            ? 12
            : 7.5;

        const textWidth =
          label.length * charWidth + 10;

        const left =
          node.x - textWidth / 2;

        const right =
          node.x + textWidth / 2;

        const top =
          node.y + Math.max(5, node.radius * 0.7) + 5;

        const bottom =
          top + 24;

        if (
          x >= left &&
          x <= right &&
          y >= top &&
          y <= bottom
        ) {
          return node;
        }
      }

      return null;
    },
    [
      graphData.nodes,
      screenToWorld,
      hoveredNodeId,
      activeNoteId,
    ]
  );

  const handleMouseDown = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    wakeUp(0.5);

    const node = findNodeUnder(
      e.clientX,
      e.clientY
    );

    dragRef.current = {
      isDraggingCanvas: !node,
      draggedNodeId: node ? node.id : null,
      startX: e.clientX,
      startY: e.clientY,
      downClientX: e.clientX,
      downClientY: e.clientY,
      hasMoved: false,
    };
  };

  const handleMouseMove = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const {
      startX,
      startY,
      isDraggingCanvas,
      draggedNodeId,
      downClientX,
      downClientY,
    } = dragRef.current;

    const totalDistance = Math.hypot(
      e.clientX - downClientX,
      e.clientY - downClientY
    );

    if (totalDistance > 5) {
      dragRef.current.hasMoved = true;
    }

    if (draggedNodeId) {
      wakeUp(0.48);

      const { x, y } = screenToWorld(
        e.clientX,
        e.clientY
      );

      const node =
        graphData.nodes.find(
          (item) => item.id === draggedNodeId
        );

      if (node) {
        node.x = x;
        node.y = y;
        node.vx =
          (e.clientX - startX) * 0.4;
        node.vy =
          (e.clientY - startY) * 0.4;
      }

      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;

      return;
    }

    if (isDraggingCanvas) {
      wakeUp(0.1);

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      transformRef.current.x += dx;
      transformRef.current.y += dy;

      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;

      return;
    }

    const node = findNodeUnder(
      e.clientX,
      e.clientY
    );

    if (node?.id !== hoveredNodeId) {
      setHoveredNodeId(
        node ? node.id : null
      );
      wakeUp(0.08);
    }
  };

  const handleMouseUp = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const {
      hasMoved,
      draggedNodeId,
      downClientX,
      downClientY,
    } = dragRef.current;

    const totalDistance = Math.hypot(
      e.clientX - downClientX,
      e.clientY - downClientY
    );

    if (!hasMoved || totalDistance <= 6) {
      const node = findNodeUnder(
        e.clientX,
        e.clientY
      );

      if (node && node.type === "note") {
        onSelectNote(node.id);
      }
    } else if (draggedNodeId) {
      wakeUp(0.35);
    }

    dragRef.current.isDraggingCanvas = false;
    dragRef.current.draggedNodeId = null;
  };

  const handleMouseLeave = () => {
    setHoveredNodeId(null);

    dragRef.current.isDraggingCanvas = false;
    dragRef.current.draggedNodeId = null;
  };

  const handleWheel = (
    e: React.WheelEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();

    wakeUp(0.15);

    const zoomFactor =
      e.deltaY < 0 ? 1.12 : 0.88;

    transformRef.current.scale =
      Math.min(
        3.5,
        Math.max(
          0.15,
          transformRef.current.scale * zoomFactor
        )
      );
  };

  const handleJiggle = () => {
    for (const node of graphData.nodes) {
      node.vx += (Math.random() - 0.5) * 8;
      node.vy += (Math.random() - 0.5) * 8;
    }

    wakeUp(1.0);
  };

  const resetView = () => {
    transformRef.current = {
      scale: 1,
      x: 0,
      y: 0,
    };

    wakeUp(0.8);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#090b0c] text-[#d1cdc4] select-none">
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.055] bg-[#101213]/94 px-5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-serif text-[13px] tracking-[0.08em] text-[#d8d4ca]">
            {graphMode === "global"
              ? "全域圖譜"
              : "局部圖譜"}
          </span>

          <span className="font-mono text-[10px] text-[#676b67]">
            {graphData.nodes.length}
            {" 節點 · "}
            {graphData.links.length}
            {" 關聯"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setGraphMode("global");
                wakeUp(0.9);
              }}
              className={`border-b pb-1 ${
                graphMode === "global"
                  ? "border-[#708f89] text-[#dad6cc]"
                  : "border-transparent text-[#767a75] hover:text-[#aaa8a0]"
              }`}
            >
              全域
            </button>

            <button
              type="button"
              disabled={!activeNoteId}
              onClick={() => {
                setGraphMode("local");
                wakeUp(0.9);
              }}
              className={`border-b pb-1 ${
                graphMode === "local"
                  ? "border-[#708f89] text-[#dad6cc]"
                  : "border-transparent text-[#767a75] hover:text-[#aaa8a0]"
              } disabled:opacity-30`}
            >
              局部
            </button>
          </div>

          <input
            type="text"
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              wakeUp(0.2);
            }}
            placeholder="搜尋節點…"
            className="w-32 border-0 border-b border-white/[0.09] bg-transparent px-1 py-1 text-[11px] text-[#c8c5bd] placeholder:text-[#535753] focus:border-[#708f89] focus:outline-none"
          />

          <button
            type="button"
            onClick={handleJiggle}
            className="text-[11px] text-[#838780] hover:text-[#d6d2c8]"
            title="重新加入物理動能"
          >
            重新舒展
          </button>

          <button
            type="button"
            onClick={resetView}
            className="text-[11px] text-[#838780] hover:text-[#d6d2c8]"
          >
            重設視角
          </button>
        </div>
      </div>

      {isCapped && graphMode === "global" && (
        <div className="border-b border-[#796454]/20 bg-[#796454]/8 px-5 py-2 text-[10px] text-[#aa9683]">
          知識庫節點較多，已限制顯示前{" "}
          {maxNodesLimit}{" "}
          個節點以維持流暢度。
        </div>
      )}

      <div
        ref={canvasWrapperRef}
        className={`relative flex-1 overflow-hidden ${
          hoveredNodeId
            ? "cursor-pointer"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          className="absolute inset-0 block h-full w-full"
        />

        <div className="pointer-events-none absolute bottom-4 right-5 font-serif text-[10px] tracking-wide text-[#5d625d]">
          點選跳轉 · 拖曳節點 · 拖曳畫布 · 滾輪縮放
        </div>

        <div className="pointer-events-none absolute bottom-5 left-5 flex h-8 w-8 items-center justify-center border border-[#a34b40]/40 font-serif text-[10px] text-[#a34b40]/60">
          墨
        </div>
      </div>
    </div>
  );
}
