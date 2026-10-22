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

/** Keys are per page load (`<prefix><tab>:<docId>`), so one tab never clears what another tab stashed. */
const TAB = Math.random().toString(36).slice(2, 10)
const ownKey = (docId: string) => `${PREFIX}${TAB}:${docId}`
const parse = (key: string) => {
  const rest = key.slice(PREFIX.length)
  const i = rest.indexOf(':')
  return i < 0 ? null : { tab: rest.slice(0, i), docId: rest.slice(i + 1) }
}

function keys(store: Storage): string[] {
  const out: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k?.startsWith(PREFIX)) out.push(k)
  }
  return out
}

/** Synchronously stashes `update` for `docId` (merged with this tab's earlier stash of the same doc). */
export function stashUpdate(docId: string, update: Uint8Array): void {
  const store = ls()
  if (!store) return
  try {
    const prev = store.getItem(ownKey(docId))
    const merged = prev ? Y.mergeUpdates([fromB64(prev), update]) : update
    store.setItem(ownKey(docId), toB64(merged))
  } catch {
    /* quota or blocked storage: nothing more can be done synchronously */
  }
}

/** Every stashed doc update (all tabs); call `clearStashedKey(key)` once it is stored in IndexedDB. */
export function readStashed(): Array<{ key: string; docId: string; update: Uint8Array }> {
  const store = ls()
  if (!store) return []
  const out: Array<{ key: string; docId: string; update: Uint8Array }> = []
  try {
    for (const key of keys(store)) {
      const id = parse(key)
      if (!id) {
        store.removeItem(key) // malformed
        continue
      }
      let update = new Uint8Array()
      try {
        update = fromB64(store.getItem(key) ?? '')
      } catch {
        /* malformed entry: an empty update, dropped by the caller */
      }
      out.push({ key, docId: id.docId, update })
    }
  } catch {
    return []
  }
  return out
}

export function clearStashedKey(key: string): void {
  try {
    ls()?.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Drops every tab's stash of a doc (it was permanently deleted). */
export function clearStashed(docId: string): void {
  const store = ls()
  if (!store) return
  try {
    for (const key of keys(store)) if (parse(key)?.docId === docId) store.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Drops what this tab stashed (its writes have since reached IndexedDB). */
export function clearOwnStashes(): void {
  const store = ls()
  if (!store) return
  try {
    for (const key of keys(store)) if (parse(key)?.tab === TAB) store.removeItem(key)
  } catch {
    /* ignore */
  }
}
