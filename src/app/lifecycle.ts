import { applyTitleDrafts } from '@/features/editor/title-drafts'
import type { AppServices } from './bootstrap'

type Win = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

export const MAINTENANCE_DELAY_MS = 5000

/**
 * Page-lifetime duties once the app is on screen:
 * - re-apply title drafts whose IndexedDB commit was cut off by the last reload/close;
 * - startup maintenance (purges, index catch-up, attachment GC) in an idle callback, off the critical path;
 * - best-effort flush of pending index work and writes when the page is hidden or unloaded
 *   (the persisted dirty markers are the real guarantee for the index);
 * - immediate retry of failed writes when the page becomes visible again or the device goes online;
 * - a leave-page warning only while a write is FAILING (in-flight writes finish on their own).
 */
export function startPageLifecycle(s: AppServices, win: Win = window, doc: Document = document): () => void {
  applyTitleDrafts(s.vault) // titles typed right before the last close/reload
  // Not urgent: start a little after the first render so it does not compete with opening the note.
  let idle: number | null = null
  const delay = setTimeout(() => {
    const run = () => void s.maintenance.runStartup()
    if (win.requestIdleCallback) idle = win.requestIdleCallback(run, { timeout: 5000 })
    else run()
  }, MAINTENANCE_DELAY_MS)
  const offDuplicates = s.maintenance.watchDuplicateTitles()

  const flush = () => {
    s.stashUnsaved() // synchronous safety net: async writes below may be cut off by the unload
    void s.indexer.flushPending()
    void s.notes.flushAll()
    void s.vault.flushWrites()
  }
  const retry = () => {
    s.notes.retryAll()
    s.vault.retryWrites()
  }
  const onVisibility = () => (doc.visibilityState === 'hidden' ? flush() : retry())
  // A beforeunload listener delays every navigation/reload (the browser must ask the page first) and
  // disables the back/forward cache, so it is only attached after a storage error was reported.
  let armed = false
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!s.notes.hasFailedWrites() && !s.vault.hasFailedWrites()) return
    e.preventDefault()
    e.returnValue = ''
  }
  const offErrors = s.storageErrors.subscribe(() => {
    if (armed) return
    armed = true
    win.addEventListener('beforeunload', onBeforeUnload as EventListener)
  })
  win.addEventListener('pagehide', flush)
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('online', retry)
  return () => {
    clearTimeout(delay)
    if (idle !== null) win.cancelIdleCallback?.(idle)
    offDuplicates()
    offErrors()
    win.removeEventListener('pagehide', flush)
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('online', retry)
    win.removeEventListener('beforeunload', onBeforeUnload as EventListener)
  }
}
