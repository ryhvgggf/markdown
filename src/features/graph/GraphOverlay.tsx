import { useEffect, useMemo, useState } from 'react'
import * as RD from '@radix-ui/react-dialog'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import {
  FULL_GRAPH_LIMIT,
  LOCAL_DEPTH_DEFAULT,
  isFormulaNodeId,
  notesUsingFormula,
  viewGraph,
  type GraphNode,
  type GraphSource,
} from '@/core/graph/graph-data'
import { loadGraphSource } from '@/core/graph/graph-source'
import { findNodes, neighborList, shortFormula } from '@/core/graph/graph-view'
import { IconButton } from '@/ui/components/IconButton'
import { Close, Sigma } from '@/ui/icons'
import { GraphCanvas, type GraphFocus } from './GraphCanvas'

const MAX_DEPTH = 3
const REFRESH_MS = 400

const pill = (on: boolean) =>
  `h-7 rounded-control px-3 text-sm outline-none transition duration-200 ease-spring focus-visible:ring-2 focus-visible:ring-accent ${
    on ? 'bg-black/[0.07] font-medium text-fg' : 'text-fg-secondary hover:bg-fill'
  }`

/** Reads the graph input while open; reloads (debounced) when the index or a title changes. */
function useGraphSource(): GraphSource | null {
  const { db, vault, indexer } = useServices()
  const [src, setSrc] = useState<GraphSource | null>(null)
  useEffect(() => {
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      loadGraphSource(db, vault, indexer).then(
        (s) => {
          if (!dead) setSrc(s)
        },
        () => undefined,
      )
    }
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(load, REFRESH_MS)
    }
    load()
    const stops = [indexer.onIndexed(later), vault.observe(later)]
    return () => {
      dead = true
      clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [db, vault, indexer])
  return src
}

export function GraphOverlay() {
  const open = useUi((s) => s.graphOpen)
  return (
    <RD.Root open={open} onOpenChange={(v) => useUi.getState().setGraph(v)}>
      <RD.Portal>
        <RD.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-[60] flex flex-col bg-white/95 backdrop-blur-2xl outline-none"
        >
          <GraphBody />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}

function GraphBody() {
  const src = useGraphSource()
  const currentId = useUi((s) => s.openNoteId)
  const [scope, setScope] = useState<'local' | 'all'>('local')
  const [depth, setDepth] = useState(LOCAL_DEPTH_DEFAULT)
  const [formulas, setFormulas] = useState(false)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<GraphFocus | null>(null)
  const [formulaId, setFormulaId] = useState<string | null>(null)

  const graph = useMemo(
    () => (src ? viewGraph(src, { scope, centerId: currentId, depth, formulas }) : { nodes: [], edges: [] }),
    [src, scope, currentId, depth, formulas],
  )
  const rows = useMemo(() => neighborList(graph), [graph])
  const hits = useMemo(() => findNodes(graph, query), [graph, query])
  const selectedFormula = formulaId && graph.nodes.some((n) => n.id === formulaId) ? formulaId : null
  const usedBy = useMemo(
    () => (src && selectedFormula ? notesUsingFormula(src, graph.nodes.find((n) => n.id === selectedFormula)!.label) : []),
    [src, selectedFormula, graph],
  )

  const openNote = (id: string) => {
    const ui = useUi.getState()
    ui.openNote(id)
    ui.setGraph(false)
  }
  const pick = (n: GraphNode) => {
    if (isFormulaNodeId(n.id) || n.kind === 'formula') setFormulaId(n.id === formulaId ? null : n.id)
    else openNote(n.id)
  }
  const jump = (n: GraphNode) => {
    setFocus({ id: n.id, seq: (focus?.seq ?? 0) + 1 })
    setQuery('')
  }

  const empty = src && graph.nodes.length === 0
  const emptyText = !src
    ? '正在讀取…'
    : formulas
      ? scope === 'local' && !currentId
        ? '先打開一篇筆記，或切到「全部」。'
        : '還沒有兩篇以上共用的公式。'
      : scope === 'local' && !currentId
        ? '先打開一篇筆記，或切到「全部」。'
        : '沒有可顯示的筆記。'

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        <RD.Title className="text-md font-semibold text-fg">關聯</RD.Title>
        <div role="group" aria-label="範圍" className="flex gap-1">
          <button type="button" aria-pressed={scope === 'local'} className={pill(scope === 'local')} onClick={() => setScope('local')}>
            局部
          </button>
          <button type="button" aria-pressed={scope === 'all'} className={pill(scope === 'all')} onClick={() => setScope('all')}>
            全部
          </button>
        </div>
        {scope === 'local' && (
          <div role="group" aria-label="層數" className="flex items-center gap-1 text-sm text-fg-secondary">
            <span>層數</span>
            <IconButton label="減少層數" disabled={depth <= 1} onClick={() => setDepth((d) => Math.max(1, d - 1))}>
              −
            </IconButton>
            <span aria-live="polite" className="w-4 text-center text-fg">
              {depth}
            </span>
            <IconButton label="增加層數" disabled={depth >= MAX_DEPTH} onClick={() => setDepth((d) => Math.min(MAX_DEPTH, d + 1))}>
              +
            </IconButton>
          </div>
        )}
        <button
          type="button"
          aria-pressed={formulas}
          title="公式視圖：顯示兩篇以上共用的公式"
          className={`${pill(formulas)} inline-flex items-center gap-1`}
          onClick={() => {
            setFormulas((v) => !v)
            setFormulaId(null)
          }}
        >
          <Sigma size={14} />
          公式
        </button>
        <div className="relative min-w-[160px] flex-1 sm:max-w-[260px]">
          <input
            type="search"
            aria-label="搜尋標題"
            placeholder="搜尋標題…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && hits[0]) jump(hits[0])
            }}
            className="h-8 w-full rounded-control bg-fill px-3 text-base text-fg outline-none placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-accent"
          />
          {hits.length > 0 && (
            <ul className="glass-float absolute top-9 right-0 left-0 z-10 max-h-64 overflow-y-auto p-1">
              {hits.map((n) => (
                <li key={n.id}>
                  <button type="button" className="w-full truncate rounded-control px-2 py-1.5 text-left text-sm hover:bg-fill" onClick={() => jump(n)}>
                    {n.kind === 'formula' ? `∑ ${shortFormula(n.label)}` : n.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {graph.truncatedFrom ? (
          <span role="status" className="text-sm text-fg-tertiary">
            只顯示連結最多的 {FULL_GRAPH_LIMIT} 篇
          </span>
        ) : null}
        <RD.Close asChild>
          <IconButton label="關閉" className="ml-auto">
            <Close />
          </IconButton>
        </RD.Close>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <GraphCanvas graph={graph} currentId={currentId} selectedId={selectedFormula} focus={focus} onNodeClick={pick} />
          {empty && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-fg-tertiary" role="status">
              {emptyText}
            </p>
          )}
        </div>
        <aside
          aria-label="清單"
          className="h-[38%] shrink-0 overflow-y-auto border-t border-black/10 p-3 md:h-auto md:w-72 md:border-t-0 md:border-l"
        >
          {selectedFormula && (
            <section aria-label="用到這個公式的筆記" className="mb-3 rounded-control bg-fill p-2">
              <h3 className="mb-1 text-sm font-medium text-fg">用到 ∑ {shortFormula(graph.nodes.find((n) => n.id === selectedFormula)?.label ?? '', 24)} 的筆記</h3>
              <ul>
                {usedBy.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="w-full truncate rounded-control px-2 py-1 text-left text-sm text-link-note hover:bg-black/5" onClick={() => openNote(n.id)}>
                      {n.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map(({ node, neighbors }) => (
              <li key={node.id}>
                <button
                  type="button"
                  aria-pressed={node.kind === 'formula' ? node.id === selectedFormula : undefined}
                  className="w-full truncate rounded-control px-2 py-1 text-left text-sm font-medium text-fg hover:bg-fill"
                  onClick={() => pick(node)}
                >
                  {node.kind === 'formula' ? `∑ ${shortFormula(node.label)}` : node.label}
                </button>
                {neighbors.length > 0 && (
                  <ul className="ml-3 border-l border-black/10 pl-2">
                    {neighbors.map((n) => (
                      <li key={n.id}>
                        <button type="button" className="w-full truncate rounded-control px-2 py-0.5 text-left text-sm text-fg-secondary hover:bg-fill" onClick={() => pick(n)}>
                          {n.kind === 'formula' ? `∑ ${shortFormula(n.label)}` : n.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  )
}
