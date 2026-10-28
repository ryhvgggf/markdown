import * as Y from 'yjs'
import type { AppServices } from '@/app/bootstrap'
import { useUi } from '@/app/ui-store'

/**
 * Test-only entry (mounted only when MODE === 'bench', see main.tsx). Drives the real Vault,
 * NoteDocCache, Indexer and SearchService so the benchmark measures production code paths.
 */
export interface BenchApi {
  seed(n: number): Promise<{ created: number; ms: number }>
  /** Runs one real search and returns its wall-clock duration in ms. */
  search(query: string): Promise<{ ms: number; hits: number }>
  /** Opens the first seeded note (the largest) in the editor. */
  openLargest(): string
  noteCount(): number
  /** Exports the vault as a ZIP, then imports it back (as copies); durations and the longest main-thread task. */
  transfer(): Promise<{ notes: number; exportMs: number; exportLongest: number; importMs: number; importLongest: number }>
}

const TOPICS = ['採購', '預算', '設計', '研究', 'Roadmap', '會議', 'Backlog', '客戶', 'Sprint', '財務']
const ZH = [
  '本季的目標是縮短流程並降低成本，各部門需要在月底前完成初步評估與回報。',
  '供應商提出的報價高於預期，我們決定先比較三家廠商，再安排下一輪議價與簽約時程。',
  '使用者回饋指出搜尋結果不夠準確，團隊將重新檢視索引策略並加入更多測試案例。',
  '會議結論：先完成原型驗證，再依照資料決定是否擴大範圍，負責人於週五前更新進度。',
]
const EN = [
  'The rollout plan depends on the review of the staging environment and the sign-off from finance.',
  'Open questions: how do we handle offline edits, and what is the fallback when storage is full?',
  'Action items were assigned during the meeting and will be tracked in the weekly status report.',
]

function el(name: string, attrs: Record<string, string>, children: Array<Y.XmlElement | Y.XmlText> = []) {
  const e = new Y.XmlElement(name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (children.length) e.insert(0, children)
  return e
}

/** A note body of ~2,000 characters: headings, mixed zh/en paragraphs, tags and links to earlier notes. */
function buildBody(i: number, linkTarget: string | null): Array<Y.XmlElement> {
  const blocks: Y.XmlElement[] = []
  let chars = 0
  let b = 0
  const id = () => `n${i}b${b++}`
  const topic = TOPICS[i % TOPICS.length]
  blocks.push(el('heading', { id: id(), level: '2' }, [new Y.XmlText(`${topic} 摘要 ${i}`)]))
  let k = i
  while (chars < 2000) {
    if (k % 5 === 0) blocks.push(el('heading', { id: id(), level: '3' }, [new Y.XmlText(`段落 ${k} Section`)]))
    const text = `${ZH[k % ZH.length]} ${EN[k % EN.length]} ${ZH[(k + 1) % ZH.length]}`
    const kids: Array<Y.XmlElement | Y.XmlText> = [new Y.XmlText(text)]
    if (k === i && linkTarget) kids.push(el('noteLink', { noteId: linkTarget }))
    if (k === i + 1) kids.push(el('tag', { name: topic.toLowerCase() }))
    blocks.push(el('paragraph', { id: id() }, kids))
    chars += text.length
    k++
  }
  return blocks
}

export function installBench(services: AppServices): void {
  const { vault, notes, db, storage, search } = services
  let seeded: string[] = []
  const oldAttachment = async () => {
    const a = vault.addAttachment({ filename: 'old.png', mimeType: 'image/png', size: 4 })
    ;(vault.doc.getMap('attachments').get(a.id) as Y.Map<unknown>).set('createdAt', Date.now() - 40 * 86_400_000)
    await storage.putBlob(a.id, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    return a.id
  }

  const api: BenchApi = {
    async seed(n) {
      const t0 = performance.now()
      const existing = vault.listNotes().filter((x) => x.title.startsWith('基準 '))
      if (existing.length >= n) {
        seeded = existing.map((x) => x.id)
        return { created: 0, ms: 0 }
      }
      const ids: string[] = []
      for (let i = 0; i < n; i++) {
        const topic = TOPICS[i % TOPICS.length]
        const meta = vault.createNote({ title: `基準 ${String(i).padStart(4, '0')} ${topic}` })
        ids.push(meta.id)
        const doc = await notes.acquire(meta.id)
        const frag = doc.getXmlFragment('content')
        const body = buildBody(i, i > 0 ? ids[i - 1] : null)
        // Every 25th note (not the opened one) references an attachment older than 30 days, so cold
        // start runs with "stale" attachments present (the case that used to trigger a full scan, I4).
        if (i % 25 === 1) body.push(el('media', { attachmentId: await oldAttachment(), kind: 'image' }))
        doc.transact(() => frag.insert(0, body))
        notes.release(meta.id)
      }
      seeded = ids
      // Wait for persistence of every note doc, then for the indexer (1 s debounce) to fill noteText.
      const deadline = Date.now() + 120_000
      for (const id of ids) {
        while ((await storage.loadDoc(id)).length === 0) {
          if (Date.now() > deadline) throw new Error('persist timeout')
          await new Promise((r) => setTimeout(r, 50))
        }
      }
      for (;;) {
        const rows = await db.noteText.where('noteId').anyOf(ids).toArray()
        if (rows.length === ids.length && rows.every((r) => r.text.length > 0)) break
        if (Date.now() > deadline) throw new Error('index timeout')
        await new Promise((r) => setTimeout(r, 200))
      }
      return { created: n, ms: performance.now() - t0 }
    },
    async search(query) {
      const t0 = performance.now()
      const hits = await search.search(query)
      return { ms: performance.now() - t0, hits: hits.length }
    },
    openLargest() {
      const id = seeded[0] ?? vault.listNotes().find((x) => x.title.startsWith('基準 '))?.id
      if (!id) throw new Error('no seeded notes')
      useUi.getState().openNote(id)
      return id
    },
    noteCount: () => vault.listNotes().length,
    async transfer() {
      let longest = 0
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => (longest = Math.max(longest, e.duration))))
      po.observe({ type: 'longtask' })
      const t0 = performance.now()
      const { blob } = await services.transfer.exportFile({ kind: 'vault' }, { includeUnusedAttachments: false })
      const exportMs = performance.now() - t0
      await new Promise((r) => setTimeout(r, 100))
      const exportLongest = longest
      longest = 0
      const t1 = performance.now()
      const src = await services.transfer.sourceFromFiles([new File([blob], 'bench.zip')])
      const tRead = performance.now()
      const plan = await services.transfer.plan(src)
      const tPlan = performance.now()
      const planLongest = longest
      const docs = services.transfer.docs
      const orig = docs.write
      let writeMs = 0
      docs.write = async (id, d) => {
        const t = performance.now()
        await orig.call(docs, id, d)
        writeMs += performance.now() - t
      }
      await services.transfer.apply(plan, src, { destination: { kind: 'new-dated' }, onExisting: 'copy' })
      docs.write = orig
      console.log(`[bench] docs.write total ${writeMs.toFixed(0)} ms`)
      console.log(`[bench] import: read ${(tRead - t1).toFixed(0)} ms, plan ${(tPlan - tRead).toFixed(0)} ms (longest ${planLongest}), apply ${(performance.now() - tPlan).toFixed(0)} ms`)
      const importMs = performance.now() - t1
      await new Promise((r) => setTimeout(r, 100))
      po.disconnect()
      return { notes: plan.notes.length, exportMs, exportLongest, importMs, importLongest: longest }
    },
  }
  ;(window as unknown as { __bench: BenchApi }).__bench = api
}
