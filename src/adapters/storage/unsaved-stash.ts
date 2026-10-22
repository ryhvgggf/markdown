import * as Y from 'yjs'

/**
 * Last-resort copy of Yjs updates that were still queued (or in flight) when the page was hidden or
 * unloaded. IndexedDB writes started during unload are often cut off; localStorage is synchronous, so
 * whatever is stashed here survives an immediate reload/close and is written to IndexedDB on the next start.
 * Updates are idempotent CRDT deltas, so replaying one that did reach IndexedDB is harmless.
 */
const PREFIX = 'notes-v2.unsaved:'

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const toB64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Synchronously stashes `update` for `docId` (merged with an earlier stash of the same doc). */
export function stashUpdate(docId: string, update: Uint8Array): void {
  const store = ls()
  if (!store) return
  try {
    const prev = store.getItem(PREFIX + docId)
    const merged = prev ? Y.mergeUpdates([fromB64(prev), update]) : update
    store.setItem(PREFIX + docId, toB64(merged))
  } catch {
    /* quota or blocked storage: nothing more can be done synchronously */
  }
}

/** Every stashed doc update; call `clear(docId)` once it is stored in IndexedDB. */
export function readStashed(): Array<{ docId: string; update: Uint8Array }> {
  const store = ls()
  if (!store) return []
  const out: Array<{ docId: string; update: Uint8Array }> = []
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (!k?.startsWith(PREFIX)) continue
      try {
        out.push({ docId: k.slice(PREFIX.length), update: fromB64(store.getItem(k) ?? '') })
      } catch {
        /* malformed entry: dropped below */
        out.push({ docId: k.slice(PREFIX.length), update: new Uint8Array() })
      }
    }
  } catch {
    return []
  }
  return out
}

export function clearStashed(docId: string): void {
  try {
    ls()?.removeItem(PREFIX + docId)
  } catch {
    /* ignore */
  }
}
