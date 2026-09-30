"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { buildGraphData, buildLocalGraphData } from "@/lib/obsidian/links";
import { GraphData, GraphNode, Note, NoteMetadata } from "@/lib/obsidian/types";

interface GraphViewProps {
  notes: Array<Note | NoteMetadata>;
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onClose?: () => void;
}

export function GraphView({
  notes,
  activeNoteId,
  onSelectNote,
  onClose,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  // 圖譜模式：global (全域圖譜) 或 local (局部圖譜)
  const [graphMode, setGraphMode] = useState<"global" | "local">(
    activeNoteId ? "local" : "global"
  );
  const [maxNodesLimit, setMaxNodesLimit] = useState<number>(300);
  const [filterQuery, setFilterQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 視角變換狀態
  const transformRef = useRef({
    scale: 1,
    x: 0,
    y: 0,
  });

  // 物理模擬與休眠狀態控制
  const simRef = useRef({
    alpha: 1.0,           // 當前物理能量 (1.0 -> 0.0)
    isSleeping: false,    // 是否進入休眠 (省電、0% CPU)
    animFrameId: 0,
    isRunning: true,
  });

  // 拖曳狀態追蹤
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

  // 取得圖譜節點與連線資料
  const [graphData, setGraphData] = useState<GraphData>(() => {
    if (activeNoteId) {
      return buildLocalGraphData(activeNoteId, notes);
    }
    return buildGraphData(notes, maxNodesLimit);
  });

  const [isCapped, setIsCapped] = useState(
    graphMode === "global" && notes.length > maxNodesLimit
  );

  // 喚醒物理模擬
  const wakeUp = useCallback((boostAlpha: number = 0.35) => {
    simRef.current.alpha = Math.max(simRef.current.alpha, boostAlpha);
    if (simRef.current.isSleeping) {
      simRef.current.isSleeping = false;
    }
  }, []);

  // 當筆記、模式或限制切換時重新計算圖譜結構
  useEffect(() => {
    let data: GraphData;
    let capped = false;

    if (graphMode === "local" && activeNoteId) {
      data = buildLocalGraphData(activeNoteId, notes);
      capped = false;
    } else {
      const res = buildGraphData(notes, maxNodesLimit);
      data = { nodes: res.nodes, links: res.links };
      capped = res.isCapped;
    }

    setIsCapped(capped);

    setGraphData((prev) => {
      const prevPos = new Map(prev.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      const newNodes = data.nodes.map((n, i) => {
        const existing = prevPos.get(n.id);
        if (existing) {
          return { ...n, x: existing.x, y: existing.y };
        }
        const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
        const dist = graphMode === "local" ? 140 : 180 + Math.random() * 80;
        return {
          ...n,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
        };
      });
      return { nodes: newNodes, links: data.links };
    });

    wakeUp(0.9);
  }, [notes, graphMode, activeNoteId, maxNodesLimit, wakeUp]);

  // 核心力導向物理引擎 (Force-Directed Engine)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    simRef.current.isRunning = true;

    // 精確根據 Canvas Wrapper (不包含 Header) 調整畫布尺寸與 DPR
    function resizeCanvas() {
      if (!canvas || !canvasWrapperRef.current) return;
      const rect = canvasWrapperRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      wakeUp(0.1);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // 物理力學更新演算法
    function stepPhysics() {
      if (simRef.current.alpha < 0.001) {
        simRef.current.isSleeping = true;
        return;
      }

      const nodes = graphData.nodes;
      const links = graphData.links;
      const nodeIndexMap = new Map(nodes.map((n, i) => [n.id, i]));

      const repulsion = graphMode === "local" ? 2800 : 1600;
      const springLength = graphMode === "local" ? 190 : 130;
      const springStrength = 0.045;
      const centerGravity = 0.015;
      const maxSpeed = 16;

      // 1. 庫倫排斥力 (帶距離上限截斷優化)
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy || 1;

          if (distSq < 176400) {
            const dist = Math.sqrt(distSq);
            const force = (repulsion / (distSq + 200)) * simRef.current.alpha;
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

      // 2. 虎克定律彈簧吸引力
      for (const link of links) {
        const idx1 = nodeIndexMap.get(link.source);
        const idx2 = nodeIndexMap.get(link.target);
        if (idx1 === undefined || idx2 === undefined) continue;

        const n1 = nodes[idx1];
        const n2 = nodes[idx2];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const displacement = dist - springLength;
        const force = displacement * springStrength * simRef.current.alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (dragRef.current.draggedNodeId !== n1.id) {
          n1.vx += fx;
          n1.vy += fy;
        }
        if (dragRef.current.draggedNodeId !== n2.id) {
          n2.vx += fx;
          n2.vy += fy;
        }
      }

      // 3. 原點中心引力與阻尼
      let maxVelocity = 0;
      for (const node of nodes) {
        if (dragRef.current.draggedNodeId === node.id) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.vx -= node.x * centerGravity * simRef.current.alpha;
        node.vy -= node.y * centerGravity * simRef.current.alpha;

        const currentSpeed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        if (currentSpeed > maxSpeed) {
          node.vx = (node.vx / currentSpeed) * maxSpeed;
          node.vy = (node.vy / currentSpeed) * maxSpeed;
        }

        node.vx *= 0.88;
        node.vy *= 0.88;

        node.x += node.vx;
        node.y += node.vy;

        maxVelocity = Math.max(maxVelocity, currentSpeed);
      }

      simRef.current.alpha *= 0.988;

      if (simRef.current.alpha < 0.002 && maxVelocity < 0.05) {
        simRef.current.isSleeping = true;
      }
    }

    // 圓角矩形膠囊繪製
    function drawRoundedRect(
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y);
      c.closePath();
    }

    // 繪製迴圈
    function render() {
      if (!ctx || !canvas) return;

      if (!simRef.current.isSleeping) {
        stepPhysics();
      }

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);

      // 背景星系暗夜漸層
      const bgGrad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        20,
        width / 2,
        height / 2,
        Math.max(width, height)
      );
      bgGrad.addColorStop(0, "#0c0d1c");
      bgGrad.addColorStop(1, "#05060b");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 移動到畫布幾何正中心並應用平移縮放
      ctx.translate(width / 2 + transformRef.current.x, height / 2 + transformRef.current.y);
      ctx.scale(transformRef.current.scale, transformRef.current.scale);

      const nodes = graphData.nodes;
      const links = graphData.links;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const activeOrHoverId = hoveredNodeId || activeNoteId;
      const neighborIds = new Set<string>();
      if (activeOrHoverId) {
        neighborIds.add(activeOrHoverId);
        for (const l of links) {
          if (l.source === activeOrHoverId) neighborIds.add(l.target);
          if (l.target === activeOrHoverId) neighborIds.add(l.source);
        }
      }

      // 1. 繪製連線
      for (const link of links) {
        const s = nodeMap.get(link.source);
        const t = nodeMap.get(link.target);
        if (!s || !t) continue;

        const isRelated =
          activeOrHoverId && (link.source === activeOrHoverId || link.target === activeOrHoverId);

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);

        if (isRelated) {
          ctx.strokeStyle = "rgba(192, 132, 252, 0.9)";
          ctx.lineWidth = 2.2;
          ctx.shadowColor = "#a855f7";
          ctx.shadowBlur = 8;
        } else {
          ctx.strokeStyle = activeOrHoverId
            ? "rgba(71, 85, 105, 0.2)"
            : "rgba(100, 116, 139, 0.35)";
          ctx.lineWidth = 1.2;
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // 2. 繪製節點
      const q = filterQuery.toLowerCase().trim();

      for (const node of nodes) {
        const isActive = node.id === activeNoteId;
        const isHovered = node.id === hoveredNodeId;
        const isNeighbor = activeOrHoverId ? neighborIds.has(node.id) : true;
        const isMatched = !q || node.label.toLowerCase().includes(q);

        const alpha = isMatched ? (isNeighbor ? 1 : 0.25) : 0.15;
        ctx.save();
        ctx.globalAlpha = alpha;

        const radius = isHovered ? node.radius + 3 : node.radius;

        // 當前節點呼吸光暈
        if (isActive) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(168, 85, 247, 0.28)";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(192, 132, 252, 0.4)";
          ctx.fill();
        }

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
          ctx.fill();
        }

        // 節點本體
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

        if (node.type === "unresolved") {
          ctx.fillStyle = "#f59e0b";
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (isActive) {
          ctx.fillStyle = "#c084fc";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.2;
          ctx.stroke();
        } else if (isHovered) {
          ctx.fillStyle = "#38bdf8";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = "#818cf8";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fill();

        // 3. 標籤文字 (帶半透明圓角膠囊背板)
        const shouldShowFullText = isHovered || isActive || graphData.nodes.length <= 15;
        let displayLabel = node.label;
        if (!shouldShowFullText && displayLabel.length > 10) {
          displayLabel = displayLabel.slice(0, 9) + "…";
        }

        const fontSize = isActive ? 12 : 11;
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
        const textMetrics = ctx.measureText(displayLabel);
        const pillWidth = textMetrics.width + 14;
        const pillHeight = fontSize + 8;
        const pillX = node.x - pillWidth / 2;
        const pillY = node.y + radius + 7;

        drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 6);
        ctx.fillStyle = isActive
          ? "rgba(88, 28, 135, 0.85)"
          : isHovered
          ? "rgba(15, 23, 42, 0.92)"
          : "rgba(15, 23, 42, 0.75)";
        ctx.fill();

        ctx.strokeStyle = isActive
          ? "rgba(192, 132, 252, 0.6)"
          : isHovered
          ? "rgba(56, 189, 248, 0.6)"
          : "rgba(51, 65, 85, 0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isActive
          ? "#ffffff"
          : isHovered
          ? "#f8fafc"
          : "#cbd5e1";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayLabel, node.x, pillY + pillHeight / 2);

        ctx.restore();
      }

      ctx.restore();

      if (simRef.current.isRunning) {
        simRef.current.animFrameId = requestAnimationFrame(render);
      }
    }

    simRef.current.animFrameId = requestAnimationFrame(render);

    return () => {
      simRef.current.isRunning = false;
      cancelAnimationFrame(simRef.current.animFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [graphData, filterQuery, activeNoteId, graphMode, hoveredNodeId, wakeUp]);

  // 精確螢幕座標轉世界座標 (以 Canvas 本身的 bounding rect 為基準，徹底排除 Header 偏差)
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // 滑鼠在 canvas 內的相對像素
    const mouseXInCanvas = clientX - rect.left;
    const mouseYInCanvas = clientY - rect.top;

    // 世界原點固定在 canvas 的 rect.width / 2, rect.height / 2
    const worldX =
      (mouseXInCanvas - rect.width / 2 - transformRef.current.x) / transformRef.current.scale;
    const worldY =
      (mouseYInCanvas - rect.height / 2 - transformRef.current.y) / transformRef.current.scale;

    return { x: worldX, y: worldY };
  }, []);

  // 尋找游標下的節點 (雙重判定：節點圓點 + 下方文字膠囊，100% 精準無死角！)
  const findNodeUnder = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const { x, y } = screenToWorld(clientX, clientY);

      for (const node of graphData.nodes) {
        // 1. 檢查圓形節點範圍
        const dx = node.x - x;
        const dy = node.y - y;
        const dist = Math.hypot(dx, dy);
        const hitRadius = Math.max(16, node.radius + 8);
        if (dist <= hitRadius) {
          return node;
        }

        // 2. 檢查下方文字膠囊 (Text Pill) 矩形範圍
        const shouldShowFullText =
          node.id === hoveredNodeId || node.id === activeNoteId || graphData.nodes.length <= 15;
        let displayLabel = node.label;
        if (!shouldShowFullText && displayLabel.length > 10) {
          displayLabel = displayLabel.slice(0, 9) + "…";
        }
        // 粗估文字寬度 (每個中文字約 12px，英文字約 7px)
        const charWidth = /[\u4e00-\u9fa5]/.test(displayLabel) ? 12 : 7.5;
        const estTextWidth = displayLabel.length * charWidth;
        const pillWidth = estTextWidth + 16;
        const pillHeight = 22;
        const pillLeft = node.x - pillWidth / 2;
        const pillRight = node.x + pillWidth / 2;
        const pillTop = node.y + node.radius + 5;
        const pillBottom = pillTop + pillHeight + 4;

        if (x >= pillLeft && x <= pillRight && y >= pillTop && y <= pillBottom) {
          return node;
        }
      }
      return null;
    },
    [graphData.nodes, screenToWorld, hoveredNodeId, activeNoteId]
  );

  // 滑鼠按下
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    wakeUp(0.5);
    const node = findNodeUnder(e.clientX, e.clientY);

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

  // 滑鼠移動
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { startX, startY, isDraggingCanvas, draggedNodeId, downClientX, downClientY } =
      dragRef.current;

    const totalDist = Math.hypot(e.clientX - downClientX, e.clientY - downClientY);
    if (totalDist > 5) {
      dragRef.current.hasMoved = true;
    }

    if (draggedNodeId) {
      wakeUp(0.45);
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      const node = graphData.nodes.find((n) => n.id === draggedNodeId);
      if (node) {
        node.x = x;
        node.y = y;
        node.vx = (e.clientX - startX) * 0.4;
        node.vy = (e.clientY - startY) * 0.4;
      }
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
    } else if (isDraggingCanvas) {
      wakeUp(0.1);
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
    } else {
      // 未按下滑鼠：即時檢測 Hover 狀態與游標樣式
      const node = findNodeUnder(e.clientX, e.clientY);
      if (node?.id !== hoveredNodeId) {
        setHoveredNodeId(node ? node.id : null);
        wakeUp(0.08);
      }
    }
  };

  // 滑鼠放開
  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { hasMoved, draggedNodeId, downClientX, downClientY } = dragRef.current;
    const totalDist = Math.hypot(e.clientX - downClientX, e.clientY - downClientY);

    // 位移在 6px 內視為精確點擊跳轉！
    if (!hasMoved || totalDist <= 6) {
      const node = findNodeUnder(e.clientX, e.clientY);
      if (node && node.type === "note") {
        onSelectNote(node.id);
      }
    } else if (draggedNodeId) {
      wakeUp(0.3);
    }

    dragRef.current.isDraggingCanvas = false;
    dragRef.current.draggedNodeId = null;
  };

  // 滑鼠移出 Canvas 區域時清除 Hover
  const handleMouseLeave = () => {
    if (hoveredNodeId) {
      setHoveredNodeId(null);
    }
    dragRef.current.isDraggingCanvas = false;
    dragRef.current.draggedNodeId = null;
  };

  // 滾輪縮放
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    wakeUp(0.15);
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newScale = Math.min(3.5, Math.max(0.15, transformRef.current.scale * zoomFactor));
    transformRef.current.scale = newScale;
  };

  // 彈力晃動
  const handleJiggle = () => {
    for (const node of graphData.nodes) {
      node.vx += (Math.random() - 0.5) * 8;
      node.vy += (Math.random() - 0.5) * 8;
    }
    wakeUp(1.0);
  };

  const resetView = () => {
    transformRef.current = { scale: 1, x: 0, y: 0 };
    wakeUp(0.8);
  };

  return (
    <div
      className={`flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative select-none rounded-3xl ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none" : "h-full w-full"
      }`}
    >
      {/* 頂部圓潤晶透控制列 */}
      <div className="flex flex-wrap items-center justify-between border-b border-purple-900/30 bg-slate-900/80 px-5 py-3 gap-3 z-10 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-500 animate-pulse"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
              {graphMode === "global" ? "全域圖譜 (Global Graph)" : "局部圖譜 (Local Graph)"}
            </span>
          </div>

          <span className="rounded-full bg-purple-950/60 border border-purple-800/40 px-3 py-0.5 text-[11px] text-purple-200 font-mono">
            {graphData.nodes.length} 節點 · {graphData.links.length} 關聯
          </span>
        </div>

        {/* 模式膠囊按鈕與過濾搜尋 */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex rounded-full bg-slate-950/80 p-1 border border-slate-800/80 shadow-inner">
            <button
              onClick={() => setGraphMode("global")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                graphMode === "global"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              全域
            </button>
            <button
              onClick={() => setGraphMode("local")}
              disabled={!activeNoteId}
              title={!activeNoteId ? "請先在左側選取筆記" : "僅展示當前筆記的關聯網絡"}
              className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                graphMode === "local"
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40"
                  : "text-slate-400 hover:text-slate-200 disabled:opacity-40"
              }`}
            >
              局部圖譜
            </button>
          </div>

          <input
            type="text"
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              wakeUp(0.2);
            }}
            placeholder="搜尋節點..."
            className="rounded-full bg-slate-950/90 border border-slate-800 px-3 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 w-28 sm:w-36 transition"
          />

          <button
            onClick={handleJiggle}
            className="rounded-full bg-slate-800/90 hover:bg-slate-700 px-3 py-1 text-xs text-purple-300 border border-slate-700/80 transition cursor-pointer flex items-center gap-1 shadow-sm"
            title="搖晃星系物理能量"
          >
            <span>✨</span>
            <span>彈力晃動</span>
          </button>

          <button
            onClick={resetView}
            className="rounded-full bg-slate-800/90 hover:bg-slate-700 px-3 py-1 text-xs text-slate-300 border border-slate-700/80 transition cursor-pointer shadow-sm"
            title="重設縮放與位置"
          >
            重設視角
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="rounded-full bg-slate-800/90 hover:bg-slate-700 p-1.5 text-xs text-slate-300 border border-slate-700/80 transition cursor-pointer"
            title={isFullscreen ? "離開全螢幕" : "全螢幕圖譜"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isFullscreen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4h-4" />
              )}
            </svg>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="rounded-full bg-rose-950/40 hover:bg-rose-900/60 p-1.5 text-xs text-rose-300 border border-rose-800/60 transition cursor-pointer"
              title="關閉圖譜"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 效能上限保護提示 */}
      {isCapped && graphMode === "global" && (
        <div className="bg-amber-950/60 border-b border-amber-800/60 px-5 py-2 text-xs text-amber-200 flex items-center justify-between z-10 backdrop-blur-md">
          <span>
            ⚡ 知識庫規模較大（筆記共 {notes.length} 篇）。已依 Obsidian 建議自動限制渲染前 {maxNodesLimit} 個節點以確保 60FPS 流暢度。
          </span>
          <button
            onClick={() => setGraphMode("local")}
            className="underline font-bold text-amber-300 hover:text-white cursor-pointer ml-3"
          >
            切換至局部圖譜 (Local Graph)
          </button>
        </div>
      )}

      {/* Canvas 專屬畫布容器 (精準排除 Header 影響) */}
      <div
        ref={canvasWrapperRef}
        className={`flex-1 relative overflow-hidden ${
          hoveredNodeId ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          className="absolute inset-0 block w-full h-full"
        />

        {/* 右下角優雅懸浮提示 */}
        <div className="absolute bottom-4 right-5 pointer-events-none rounded-full bg-slate-900/70 backdrop-blur-md px-3.5 py-1 text-[11px] text-slate-400 border border-slate-800/80 shadow-lg flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400"></span>
          <span>點選節點或標籤直接跳轉 · 拖曳節點彈性牽引 · 滾輪縮放</span>
        </div>
      </div>
    </div>
  );
}
