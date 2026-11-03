/**
 * What the UI shows about cloud sync (3f-2). Sync runs in one tab only (`sync-leader.ts`); that tab feeds
 * reports in here and shares the result with the other tabs over a BroadcastChannel, so every tab shows
 * the same status. A tab that is not syncing never changes the status on its own, only through messages.
 *
 * - `offline` issues clear by themselves once pending pushes go through (the connection is back).
 * - Everything else stays until the user dismisses it (dismiss clears all).
 */
export type SyncIssueKind = 'offline' | 'conflict' | 'failed'
export interface SyncIssue {
  docId: string
  kind: SyncIssueKind
}
export interface SyncStatus {
  state: 'off' | 'syncing' | 'synced' | 'error'
  issues: SyncIssue[]
  /** Notes whose content is still being fetched from the cloud right after sync started (absent when none). */
  loading?: string[]
}

export interface SyncReporter {
  pending(pending: boolean): void
  /** The notes still being fetched (replaces the previous list). */
  loading(noteIds: string[]): void
  error(e: unknown, docId: string): void
}

export interface SyncStatusStore {
  get(): SyncStatus
  subscribe(cb: () => void): () => void
  /** A new sync run in this tab (it may still be waiting for the sync lock). */
  start(): SyncReporter
  stop(): void
  dismiss(): void
  close(): void
}

type Msg = { t: 'status'; status: SyncStatus } | { t: 'ask' } | { t: 'dismiss' }

const OFF: SyncStatus = { state: 'off', issues: [] }
const CHANNEL = 'notes-v2-sync-status'

const kindOf = (e: unknown): SyncIssueKind => {
  const k = (e as { kind?: string } | null)?.kind
  return k === 'offline' ? 'offline' : k === 'conflict' ? 'conflict' : 'failed'
}

export function createSyncStatus(opts: { channelFactory?: (name: string) => BroadcastChannel } = {}): SyncStatusStore {
  let status = OFF
  let pending = false
  let loadingIds: string[] = []
  let run = 0
  /** This tab is the one syncing (it has reported something in the current run). */
  let active = false
  const listeners = new Set<() => void>()

  const channel = (() => {
    try {
      return opts.channelFactory?.(CHANNEL) ?? (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL))
    } catch {
      return null
    }
  })()
  const post = (m: Msg) => {
    try {
      channel?.postMessage(m)
    } catch {
      /* other tabs catch up on the next change */
    }
  }

  const set = (next: SyncStatus, broadcast: boolean) => {
    status = next
    listeners.forEach((l) => l())
    if (broadcast) post({ t: 'status', status })
  }
  const derive = (issues: SyncIssue[]): SyncStatus => ({
    state: issues.length ? 'error' : pending ? 'syncing' : 'synced',
    issues,
    ...(loadingIds.length ? { loading: loadingIds } : {}),
  })
  const dismissHere = () => set(derive([]), true)

  const onMessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data
    if (m.t === 'status' && !active) set(m.status, false)
    else if (m.t === 'ask' && active) post({ t: 'status', status })
    else if (m.t === 'dismiss' && active) dismissHere()
  }
  channel?.addEventListener('message', onMessage)
  post({ t: 'ask' })

  return {
    get: () => status,
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    start() {
      const id = ++run
      pending = false
      loadingIds = []
      const live = () => {
        if (id !== run) return false
        active = true
        return true
      }
      return {
        pending(p) {
          const first = !active
          if (!live() || (!first && p === pending)) return
          const cleared = pending && !p
          pending = p
          set(derive(cleared ? status.issues.filter((i) => i.kind !== 'offline') : status.issues), true)
        },
        loading(noteIds) {
          if (!live() || (noteIds.length === loadingIds.length && noteIds.every((n, i) => n === loadingIds[i]))) return
          loadingIds = noteIds
          set(derive(status.issues), true)
        },
        error(e, docId) {
          if (!live()) return
          const kind = kindOf(e)
          const issues = status.issues.some((i) => i.docId === docId && i.kind === kind) ? status.issues : [...status.issues, { docId, kind }]
          set(derive(issues), true)
        },
      }
    },
    stop() {
      run++
      const wasActive = active
      active = false
      pending = false
      loadingIds = []
      set(OFF, wasActive)
    },
    dismiss() {
      if (active || !channel) dismissHere()
      else post({ t: 'dismiss' })
    },
    close() {
      run++
      channel?.removeEventListener('message', onMessage)
      channel?.close()
    },
  }
}

/** Feeds a sync manager's pending state into `report` while it runs (polled; the manager has no event for it). */
export function reportingProgress<M extends { start(): Promise<void>; close(): Promise<void>; hasPending(): boolean; loadingNoteIds?(): string[] }>(
  manager: M,
  report: SyncReporter,
  everyMs = 1500,
): { start(): Promise<void>; close(): Promise<void> } {
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    async start() {
      report.pending(true)
      // The notes still coming down show as loading while start() runs (it resolves when the last one is here).
      const poll = setInterval(() => report.loading(manager.loadingNoteIds?.() ?? []), 300)
      try {
        await manager.start()
      } finally {
        clearInterval(poll)
        report.loading([])
      }
      report.pending(manager.hasPending())
      timer = setInterval(() => report.pending(manager.hasPending()), everyMs)
    },
    async close() {
      if (timer) clearInterval(timer)
      timer = null
      await manager.close()
    },
  }
}
