import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ServicesProvider } from '@/app/services-context'
import type { AppServices } from '@/app/bootstrap'
import { useUi } from '@/app/ui-store'
import type { GraphSource } from '@/core/graph/graph-data'
import { GraphOverlay } from './GraphOverlay'

let source: GraphSource
vi.mock('@/core/graph/graph-source', () => ({ loadGraphSource: () => Promise.resolve(source) }))
const canvasProps = vi.fn()
vi.mock('./GraphCanvas', () => ({
  GraphCanvas: (p: { graph: { nodes: { id: string; label: string }[] }; focus: unknown; onNodeClick(n: unknown): void }) => {
    canvasProps(p)
    return (
      <div data-testid="canvas">
        {p.graph.nodes.map((n) => (
          <button key={n.id} type="button" data-node={n.id} onClick={() => p.onNodeClick(n)} />
        ))}
      </div>
    )
  },
}))

const note = (id: string, title: string, formulas: string[] = []) => ({ id, title, folderId: null, formulas })
const services = { db: {}, vault: { observe: () => () => undefined }, indexer: { onIndexed: () => () => undefined } } as unknown as AppServices
const renderOverlay = () =>
  render(
    <ServicesProvider services={services}>
      <GraphOverlay />
    </ServicesProvider>,
  )
const list = () => within(screen.getByRole('complementary', { name: '清單' }))

beforeEach(() => {
  source = {
    notes: [note('a', 'Alpha', ['x^2']), note('b', 'Beta', ['x^2']), note('c', 'Gamma'), note('d', 'Delta')],
    links: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ],
  }
  canvasProps.mockClear()
  useUi.setState({ graphOpen: true, openNoteId: null })
})
afterEach(cleanup)

describe('GraphOverlay', () => {
  it('local view needs an open note; with one it shows that note and its neighbours', async () => {
    renderOverlay()
    expect(await screen.findByText('先打開一篇筆記，或切到「全部」。')).toBeInTheDocument()
    cleanup()
    useUi.setState({ openNoteId: 'a' })
    renderOverlay()
    await waitFor(() => expect(list().getAllByRole('button', { name: 'Beta' }).length).toBeGreaterThan(0))
    expect(list().queryByRole('button', { name: 'Gamma' })).toBeNull() // two steps away
    fireEvent.click(screen.getByRole('button', { name: '增加層數' }))
    await waitFor(() => expect(list().getAllByRole('button', { name: 'Gamma' }).length).toBeGreaterThan(0))
  })

  it('全部 lists every note with its neighbours; clicking one opens it and closes the layer', async () => {
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    await waitFor(() => expect(list().getByRole('button', { name: 'Delta' })).toBeInTheDocument())
    fireEvent.click(list().getByRole('button', { name: 'Delta' }))
    expect(useUi.getState()).toMatchObject({ openNoteId: 'd', graphOpen: false })
  })

  it('clicking a node on the canvas opens that note', async () => {
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    await waitFor(() => expect(document.querySelector('[data-node="c"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-node="c"]')!)
    expect(useUi.getState()).toMatchObject({ openNoteId: 'c', graphOpen: false })
  })

  it('formula view shows shared formulas; selecting one lists the notes that use it', async () => {
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    fireEvent.click(screen.getByRole('button', { name: /公式/ }))
    await waitFor(() => expect(list().getAllByRole('button', { name: '∑ x^2' }).length).toBeGreaterThan(0))
    fireEvent.click(list().getAllByRole('button', { name: '∑ x^2' })[0]!) // its own row; the notes list it too
    const used = screen.getByRole('region', { name: '用到這個公式的筆記' })
    expect(within(used).getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(within(used).getByRole('button', { name: 'Beta' })).toBeInTheDocument()
    expect(within(used).queryByRole('button', { name: 'Gamma' })).toBeNull()
  })

  it('formula view with no shared formula says so', async () => {
    source.notes = [note('a', 'Alpha', ['x']), note('b', 'Beta', ['y'])]
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    fireEvent.click(screen.getByRole('button', { name: /公式/ }))
    expect(await screen.findByText('還沒有兩篇以上共用的公式。')).toBeInTheDocument()
  })

  it('tells when only the most linked 300 are shown', async () => {
    source.notes = Array.from({ length: 305 }, (_, i) => note(`n${i}`, `Note ${i}`))
    source.links = []
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    expect(await screen.findByText('只顯示連結最多的 300 篇')).toBeInTheDocument()
  })

  it('title search jumps the canvas to the node', async () => {
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    const box = screen.getByRole('searchbox', { name: '搜尋標題' })
    await waitFor(() => expect(list().getByRole('button', { name: 'Delta' })).toBeInTheDocument())
    fireEvent.change(box, { target: { value: 'delt' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(canvasProps).toHaveBeenLastCalledWith(expect.objectContaining({ focus: expect.objectContaining({ id: 'd' }) }))
    expect(useUi.getState().graphOpen).toBe(true)
  })

  it('Esc and × close it', async () => {
    renderOverlay()
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    expect(useUi.getState().graphOpen).toBe(false)
    cleanup()
    useUi.setState({ graphOpen: true })
    renderOverlay()
    fireEvent.click(await screen.findByRole('button', { name: '關閉' }))
    expect(useUi.getState().graphOpen).toBe(false)
  })
})
