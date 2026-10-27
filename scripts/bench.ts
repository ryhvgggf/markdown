/**
 * Performance benchmark: builds the app in `bench` mode (which mounts window.__bench), serves it,
 * seeds 1,000 notes (40 of them referencing attachments older than 30 days) and measures cold start, search latency and per-keystroke handling time.
 * Run with `npm run bench` (Node >= 22.18 strips the types natively).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'

const OUT_DIR = 'dist-bench'
const VITE = join(process.cwd(), 'node_modules', '.bin', 'vite')
const NOTES = 1000
const THRESHOLDS = { coldStart: 1500, search: 100, keystroke: 16, frame: 16.7 }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

async function waitForServer(url: string, proc: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('vite preview exited early')
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview server did not start')
}

const ready = (page: Page) =>
  page.waitForFunction(
    () => {
      const ed = document.querySelector('.ProseMirror')
      const title = document.querySelector<HTMLInputElement>('input[aria-label="筆記標題"]')
      return ed?.getAttribute('contenteditable') === 'true' && !!title && title.value !== ''
    },
    undefined,
    { polling: 'raf', timeout: 30_000 },
  )

async function main() {
  console.log(`Building (mode=bench) into ${OUT_DIR}…`)
  const build = spawnSync(VITE, ['build', '--mode', 'bench', '--outDir', OUT_DIR, '--emptyOutDir'], { stdio: 'inherit' })
  if (build.status !== 0) throw new Error('bench build failed')

  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  const preview = spawn(VITE, ['preview', '--mode', 'bench', '--outDir', OUT_DIR, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore',
  })
  const userDataDir = mkdtempSync(join(tmpdir(), 'notes-bench-'))
  const cleanup = () => {
    preview.kill()
    rmSync(userDataDir, { recursive: true, force: true })
  }
  try {
    await waitForServer(url, preview)
    const context = await chromium.launchPersistentContext(userDataDir, { headless: true })
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('pageerror', (e) => console.error('pageerror:', e.message))
    await page.goto(url)
    await page.waitForFunction(() => '__bench' in window, undefined, { timeout: 30_000 })

    console.log(`Seeding ${NOTES} notes (~2,000 chars each)…`)
    const seed = await page.evaluate((n) => (window as any).__bench.seed(n), NOTES) // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log(`  seeded in ${(seed.ms / 1000).toFixed(1)} s`)
    // Open a seeded note so that it is the "last note" restored on every reload.
    await page.evaluate(() => (window as any).__bench.openLargest()) // eslint-disable-line @typescript-eslint/no-explicit-any
    await ready(page)
    await page.waitForTimeout(1500) // lastNoteId + indexer settle

    // (1) cold start: reload → editable editor with a title
    const cold: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      await page.reload({ waitUntil: 'commit' })
      await ready(page)
      cold.push(performance.now() - t0)
    }

    // (2) search latency through the real SearchService (worker)
    await page.waitForFunction(() => '__bench' in window)
    const search = await page.evaluate(async () => {
      const b = (window as any).__bench // eslint-disable-line @typescript-eslint/no-explicit-any
      for (let i = 0; i < 5; i++) await b.search('採購') // warm-up
      const ms: number[] = []
      let hits = 0
      for (let i = 0; i < 20; i++) {
        const r = await b.search('採購')
        ms.push(r.ms)
        hits = r.hits
      }
      return { ms, hits }
    })

    // (3) typing in a large note
    const textLen = await page.locator('.ProseMirror').evaluate((el) => el.textContent?.length ?? 0)
    await page.evaluate(() => {
      const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
      w.__keys = [] as number[] // per keystroke: summed handler time (Event Timing's processingEnd - processingStart)
      w.__e2e = [] as number[] // per keystroke: keydown → end of the input task (includes any rendering in between)
      w.__slow = [] as number[]
      w.__frame = [] as number[] // per keystroke: keydown → the next animation frame after its input event (rAF callback)
      w.__painted = [] as number[] // per keystroke: keydown → the task right after that frame (the frame has been produced)
      // Event Timing only reports events whose duration >= 16 ms, so its mean is biased. The same quantity is
      // measured for EVERY event here: capture listener = processingStart, bubble listener = processingEnd.
      const types = ['keydown', 'keypress', 'beforeinput', 'input', 'keyup']
      const start: Record<string, number> = {}
      let sum = 0
      let t0 = 0
      const chan = new MessageChannel()
      chan.port1.onmessage = () => w.__e2e.push(performance.now() - t0)
      for (const type of types) {
        window.addEventListener(type, () => (start[type] = performance.now()), true)
        window.addEventListener(type, () => {
          sum += performance.now() - start[type]
          if (type === 'keydown') t0 = start[type]
          if (type === 'input') {
            w.__keys.push(sum)
            sum = 0
            chan.port2.postMessage(0)
            const k0 = t0
            requestAnimationFrame(() => {
              w.__frame.push(performance.now() - k0)
              const after = new MessageChannel()
              after.port1.onmessage = () => w.__painted.push(performance.now() - k0)
              after.port2.postMessage(0)
            })
          }
        })
      }
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as PerformanceEventTiming[]) {
          if (e.name === 'keydown' || e.name === 'keypress' || e.name === 'input') w.__slow.push(e.processingEnd - e.processingStart)
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
    })
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('Control+End')
    const sample = 'The quick brown fox jumps over the lazy dog while we measure typing latency. '
    await page.keyboard.type((sample + sample).slice(0, 100), { delay: 20 })
    await page.waitForTimeout(500)
    const typing = await page.evaluate(() => {
      const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
      return { keys: w.__keys as number[], e2e: w.__e2e as number[], slow: w.__slow as number[], frame: w.__frame as number[], painted: w.__painted as number[] }
    })

    await context.close()

    const rows = [
      { name: '冷啟動 (reload → 可輸入, 中位數 of 5)', value: median(cold), limit: THRESHOLDS.coldStart },
      { name: `搜尋「採購」(中位數 of 20, ${search.hits} 筆結果)`, value: median(search.ms), limit: THRESHOLDS.search },
      { name: `按鍵處理 (平均 of ${typing.keys.length} 鍵, 筆記 ${textLen} 字)`, value: mean(typing.keys), limit: THRESHOLDS.keystroke },
      { name: `按鍵 → 下一幀 (keydown → rAF after input, p95 of ${typing.frame.length})`, value: p95(typing.frame), limit: THRESHOLDS.frame },
    ]
    console.log('\n| 指標 | 結果 (ms) | 門檻 (ms) | 判定 |')
    console.log('|---|---|---|---|')
    let failed = false
    for (const r of rows) {
      const ok = r.value < r.limit
      if (!ok) failed = true
      console.log(`| ${r.name} | ${r.value.toFixed(1)} | < ${r.limit} | ${ok ? 'PASS' : 'FAIL'} |`)
    }
    console.log('\nDetails:')
    console.log(`  cold start runs (ms): ${cold.map((x) => x.toFixed(0)).join(', ')}`)
    console.log(`  search min/max (ms): ${Math.min(...search.ms).toFixed(1)} / ${Math.max(...search.ms).toFixed(1)}`)
    console.log(
      `  keystroke median/p95/max (ms): ${median(typing.keys).toFixed(1)} / ${[...typing.keys].sort((a, b) => a - b)[Math.floor(typing.keys.length * 0.95)]?.toFixed(1)} / ${Math.max(...typing.keys).toFixed(1)}`,
    )
    console.log(`  keystroke end-to-end (keydown → input task end) mean/median: ${mean(typing.e2e).toFixed(1)} / ${median(typing.e2e).toFixed(1)}`)
    console.log(
      `  keydown → next frame (rAF) median/p95/max (ms): ${median(typing.frame).toFixed(1)} / ${p95(typing.frame).toFixed(1)} / ${Math.max(...typing.frame).toFixed(1)}; ` +
        `→ after that frame median/p95: ${median(typing.painted).toFixed(1)} / ${p95(typing.painted).toFixed(1)}`,
    )
    console.log(
      `  Event Timing (only reports events with duration >= 16 ms): ${typing.slow.length} slow keydown/keypress/input events` +
        (typing.slow.length ? `, mean handler ${mean(typing.slow).toFixed(1)} ms` : ''),
    )
    console.log('  keystroke method: summed capture→bubble listener time of keydown/keypress/beforeinput/input per key (= Event Timing processing time, but for every event); ASCII keys so keydown fires.')
    process.exitCode = failed ? 1 : 0
  } finally {
    cleanup()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
