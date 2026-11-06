import { useEffect, useRef } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { Graph, GraphNode } from '@/core/graph/graph-data'
import { folderColor, neighborIds, shortFormula } from '@/core/graph/graph-view'

interface SimNode extends SimulationNodeDatum {
  id: string
  node: GraphNode
  r: number
}
type SimLink = SimulationLinkDatum<SimNode>
interface View {
  k: number
  x: number
  y: number
}

export interface GraphFocus {
  id: string
  /** Changes on every request, so focusing the same node twice still moves the view. */
  seq: number
}
export interface GraphCanvasProps {
  graph: Graph
  /** The open note (ringed). */
  currentId: string | null
  /** The formula node whose notes are listed (ringed). */
  selectedId: string | null
  focus: GraphFocus | null
  onNodeClick(node: GraphNode): void
}

const radius = (n: GraphNode) => (n.kind === 'formula' ? 10 : 4.5 + Math.min(7, Math.sqrt(n.degree) * 2))
const MIN_K = 0.2
const MAX_K = 4
const LABEL_ALL_MAX = 40
const FONT = '12px "Noto Sans TC", system-ui, sans-serif'

/** canvas + d3-force. Positions survive a data refresh (same ids keep their place). */
export function GraphCanvas({ graph, currentId, selectedId, focus, onNodeClick }: GraphCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodes = useRef<SimNode[]>([])
  const links = useRef<SimLink[]>([])
  const view = useRef<View>({ k: 1, x: 0, y: 0 })
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const hover = useRef<string | null>(null)
  const props = useRef({ graph, currentId, selectedId, onNodeClick })
  const raf = useRef(0)
  const fitPending = useRef(true)
  const draw = useRef<() => void>(() => undefined)

  useEffect(() => {
    props.current = { graph, currentId, selectedId, onNodeClick }
    schedule()
  })

  function schedule() {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      draw.current()
    })
  }

  /** The first time a layout settles, zoom so the whole graph is in view. */
  function fit() {
    const ns = nodes.current
    const { w, h } = size.current
    if (!fitPending.current || ns.length === 0 || w === 0) return
    fitPending.current = false
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const n of ns) {
      x0 = Math.min(x0, (n.x ?? 0) - n.r)
      x1 = Math.max(x1, (n.x ?? 0) + n.r)
      y0 = Math.min(y0, (n.y ?? 0) - n.r)
      y1 = Math.max(y1, (n.y ?? 0) + n.r)
    }
    const k = Math.min(1.6, Math.max(MIN_K, 0.8 * Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))))
    view.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k }
    schedule()
  }

  // (Re)build the simulation when the graph changes; nodes already on screen keep their position.
  useEffect(() => {
    const old = new Map(nodes.current.map((n) => [n.id, n]))
    const next = graph.nodes.map<SimNode>((node) => {
      const prev = old.get(node.id)
      return { id: node.id, node, r: radius(node), x: prev?.x, y: prev?.y, vx: prev?.vx, vy: prev?.vy }
    })
    const byId = new Map(next.map((n) => [n.id, n]))
    const ls: SimLink[] = graph.edges.flatMap((e) => {
      const source = byId.get(e.source)
      const target = byId.get(e.target)
      return source && target ? [{ source, target }] : []
    })
    nodes.current = next
    links.current = ls
    sim.current?.stop()
    const s = forceSimulation<SimNode>(next)
      .force('link', forceLink<SimNode, SimLink>(ls).distance(80).strength(0.6))
      .force('charge', forceManyBody<SimNode>().strength(-180))
      .force('collide', forceCollide<SimNode>((n) => n.r + 3))
      .force('x', forceX<SimNode>(0).strength(0.04))
      .force('y', forceY<SimNode>(0).strength(0.04))
      .on('tick', schedule)
      .on('end', fit)
    if (old.size > 0) s.alpha(0.4)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      s.stop()
      s.tick(300)
      fit()
    }
    sim.current = s
    return () => {
      s.stop()
    }
    // fit/schedule only touch refs; the simulation must be rebuilt only when the graph changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // Size the canvas to its box.
  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    if (!el || !cv) return
    const fit = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = window.devicePixelRatio || 1
      const first = size.current.w === 0
      size.current = { w, h, dpr }
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(h * dpr))
      if (first) view.current = { k: 1, x: w / 2, y: h / 2 }
      schedule()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Move the view to a node asked for by the title search.
  useEffect(() => {
    if (!focus) return
    const n = nodes.current.find((x) => x.id === focus.id)
    if (!n) return
    const k = Math.max(view.current.k, 1.4)
    view.current = { k, x: size.current.w / 2 - (n.x ?? 0) * k, y: size.current.h / 2 - (n.y ?? 0) * k }
    hover.current = focus.id
    schedule()
  }, [focus])

  draw.current = () => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const { dpr } = size.current
    const v = view.current
    const { graph: g, currentId: cur, selectedId: sel } = props.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y)
    const hov = hover.current
    const lit = hov ? neighborIds(g, hov) : null
    const dim = (id: string) => (lit && !lit.has(id) ? 0.14 : 1)

    ctx.lineWidth = 1 / v.k
    for (const l of links.current) {
      const a = l.source as SimNode
      const b = l.target as SimNode
      const on = !lit || (lit.has(a.id) && lit.has(b.id) && (a.id === hov || b.id === hov))
      ctx.strokeStyle = on ? 'rgba(60,60,67,0.35)' : 'rgba(60,60,67,0.06)'
      ctx.beginPath()
      ctx.moveTo(a.x ?? 0, a.y ?? 0)
      ctx.lineTo(b.x ?? 0, b.y ?? 0)
      ctx.stroke()
    }

    const showAll = nodes.current.length <= LABEL_ALL_MAX
    const labels: SimNode[] = []
    for (const n of nodes.current) {
      const x = n.x ?? 0
      const y = n.y ?? 0
      ctx.globalAlpha = dim(n.id)
      if (n.node.kind === 'formula') {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#5f5f66'
        ctx.lineWidth = 1.5 / v.k
        ctx.beginPath()
        ctx.arc(x, y, n.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#1d1d1f'
        ctx.font = `bold ${n.r * 1.35}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('∑', x, y + 0.5)
      } else {
        ctx.fillStyle = n.node.degree === 0 ? 'rgba(142,142,147,0.45)' : folderColor(n.node.folderId)
        ctx.beginPath()
        ctx.arc(x, y, n.r, 0, Math.PI * 2)
        ctx.fill()
      }
      if (n.id === cur || n.id === sel) {
        ctx.strokeStyle = '#1d1d1f'
        ctx.lineWidth = 2 / v.k
        ctx.beginPath()
        ctx.arc(x, y, n.r + 3, 0, Math.PI * 2)
        ctx.stroke()
      }
      if ((hov ? lit?.has(n.id) : showAll) || n.id === cur) labels.push(n)
    }

    ctx.globalAlpha = 1
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const n of labels) {
      const text = n.node.kind === 'formula' ? shortFormula(n.node.label) : n.node.label
      const x = n.x ?? 0
      const y = (n.y ?? 0) + n.r + 4
      ctx.lineWidth = 3 / v.k
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = n.id === hov ? '#1d1d1f' : '#5f5f66'
      ctx.fillText(text, x, y)
    }

    // End-to-end tests find nodes through this; it costs nothing outside automation.
    if (navigator.webdriver) {
      cv.dataset.nodes = JSON.stringify(
        nodes.current.map((n) => ({ id: n.id, label: n.node.label, x: v.x + (n.x ?? 0) * v.k, y: v.y + (n.y ?? 0) * v.k })),
      )
    }
  }

  // Pointer, wheel and pinch.
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { kind: 'node'; node: SimNode } | { kind: 'pan' } | null = null
    let moved = 0
    let pinch = 0

    const local = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const world = (p: { x: number; y: number }) => ({ x: (p.x - view.current.x) / view.current.k, y: (p.y - view.current.y) / view.current.k })
    const hit = (p: { x: number; y: number }) => {
      const w = world(p)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of nodes.current) {
        const d = Math.hypot((n.x ?? 0) - w.x, (n.y ?? 0) - w.y)
        if (d <= n.r + 4 / view.current.k && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }
    const zoomAt = (p: { x: number; y: number }, factor: number) => {
      const v = view.current
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor))
      const f = k / v.k
      view.current = { k, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f }
      schedule()
    }

    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId)
      const p = local(e)
      pointers.set(e.pointerId, p)
      moved = 0
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        drag = null
        return
      }
      const n = hit(p)
      if (n) {
        const w = world(p)
        n.fx = w.x
        n.fy = w.y
        sim.current?.alphaTarget(0.25).restart()
        drag = { kind: 'node', node: n }
      } else {
        drag = { kind: 'pan' }
      }
    }
    const move = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (prev) pointers.set(e.pointerId, p)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch > 0 && d > 0) zoomAt({ x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }, d / pinch)
        pinch = d
        moved = 99
        return
      }
      if (!prev || !drag) {
        const n = hit(p)
        const id = n?.id ?? null
        if (id !== hover.current) {
          hover.current = id
          cv.style.cursor = id ? 'pointer' : 'grab'
          schedule()
        }
        return
      }
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)
      if (drag.kind === 'node') {
        const w = world(p)
        drag.node.fx = w.x
        drag.node.fy = w.y
      } else {
        view.current = { ...view.current, x: view.current.x + p.x - prev.x, y: view.current.y + p.y - prev.y }
      }
      schedule()
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinch = 0
      const d = drag
      if (pointers.size > 0) return
      drag = null
      if (d?.kind === 'node') {
        d.node.fx = null
        d.node.fy = null
        sim.current?.alphaTarget(0)
        if (moved < 6) props.current.onNodeClick(d.node.node)
      }
    }
    const leave = () => {
      if (hover.current && pointers.size === 0) {
        hover.current = null
        schedule()
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(local(e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }

    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('pointerleave', leave)
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      cv.removeEventListener('pointerleave', leave)
      cv.removeEventListener('wheel', wheel)
    }
  }, [])

  useEffect(
    () => () => {
      sim.current?.stop()
      cancelAnimationFrame(raf.current)
    },
    [],
  )

  return (
    <div ref={wrap} className="relative min-h-0 min-w-0 flex-1">
      <canvas
        ref={canvas}
        data-testid="graph-canvas"
        role="img"
        aria-label="關聯圖。用鍵盤或螢幕閱讀器時，請使用旁邊的清單。"
        className="absolute inset-0 size-full cursor-grab touch-none"
      />
    </div>
  )
}
