/**
 * Runs `fn` when the main thread is idle (requestIdleCallback with a deadline), or in a separate task
 * where that API is missing (Safari). Either way never inside the current event (e.g. a keystroke).
 * Returns a cancel function.
 */
export function onIdle(fn: () => void, timeout = 300): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 1)
  return () => clearTimeout(id)
}
