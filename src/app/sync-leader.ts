import type { SyncHandle } from './account-service'

export interface Startable {
  start(): Promise<void>
  close(): Promise<void>
}

type Locks = { request(name: string, opts: { signal: AbortSignal }, cb: () => Promise<void>): Promise<void> }

/**
 * Runs cloud sync in one tab at a time (Web Lock `notes-v2-sync`). The other tabs wait in line and take over
 * when the holder closes. One tab is enough: every edit made in another tab reaches it through `tabs-bridge`
 * and is pushed from there, and what it pulls from the cloud reaches the other tabs the same way. Without
 * Web Locks (old browsers, tests) the tab simply runs it.
 */
export function runAsSyncLeader(
  create: () => Startable | Promise<Startable>,
  opts: { locks?: Locks | null; onError?: (e: unknown) => void } = {},
): SyncHandle {
  const locks =
    opts.locks !== undefined
      ? opts.locks
      : ((globalThis.navigator as (Navigator & { locks?: Locks }) | undefined)?.locks ?? null)
  const abort = new AbortController()
  let release: (() => void) | null = null
  let stopped = false

  const run = async () => {
    if (stopped) return
    const manager = await create()
    try {
      if (stopped) return
      await manager.start()
      if (stopped) return
      await new Promise<void>((resolve) => (release = resolve))
    } finally {
      await manager.close()
    }
  }
  const done = (locks ? locks.request('notes-v2-sync', { signal: abort.signal }, run) : run()).catch((e: unknown) => {
    if (!(e instanceof DOMException && e.name === 'AbortError')) opts.onError?.(e)
  })

  return {
    async stop() {
      stopped = true
      abort.abort()
      release?.()
      await done
    },
  }
}
