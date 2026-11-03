import type { Vault } from '@/core/vault/vault'

/** What a row's cloud shows while choosing what to sync: all synced, none, or some of a folder's notes. */
export type CloudState = 'on' | 'off' | 'partial'

export interface SelectionModel {
  /** The cloud state of a note or folder row. */
  state(id: string): CloudState
  /** The state a note ends up in (its own pick wins, else the folders above it decide, else it stays as it is). */
  noteOn(id: string): boolean
  /** Every live note and what it would become. */
  counts: { total: number; on: number; stopping: number; starting: number }
  /** Titles of notes that would stop syncing (first `limit`) and how many more there are. */
  stoppingTitles(limit: number): { titles: string[]; more: number }
  /** `picks` after clicking one row: a folder takes everything inside it along; a partial folder turns fully on. */
  toggled(id: string): Map<string, boolean>
  /** `picks` after 全選 (everything on) or, when everything already is, 全不選. */
  allToggled(): Map<string, boolean>
  /** Whether everything is on (decides whether the button says 全選 or 全不選). */
  allOn: boolean
  /** Applies the picks to the vault: folders first (they set their notes), then notes that still differ. */
  apply(): void
}

/**
 * The 同步到雲端 selection (3f-5): which notes and folders are ticked, built from what the vault has now and the
 * clicks made so far (`picks`: id → the state clicked into). Pure; the sidebar renders from it and applies it.
 */
export function createSelectionModel(vault: Vault, picks: ReadonlyMap<string, boolean>): SelectionModel {
  const folders = new Map(vault.listFolders().map((f) => [f.id, f]))
  const notes = vault.listNotes()
  const folderOn = (id: string) => picks.get(id) ?? folders.get(id)?.synced === true

  const noteOn = (id: string): boolean => {
    const own = picks.get(id)
    if (own !== undefined) return own
    const note = vault.getNote(id)
    if (!note) return false
    let clicked = false
    let held = false
    for (let f = note.folderId, guard = 0; f !== null && guard < 10000; guard++) {
      const folder = folders.get(f)
      if (!folder) break
      if (picks.has(f)) {
        if (picks.get(f)) return true
        clicked = true
      } else if (folder.synced === true) held = true
      f = folder.parentId
    }
    return clicked ? held : note.synced === true
  }

  // Per folder: how many live notes lie anywhere under it, and how many of those are on.
  const under = new Map<string, { total: number; on: number }>()
  const descendants = new Map<string, string[]>() // folder id → ids of every folder and note under it
  const noteStates = new Map(notes.map((n) => [n.id, noteOn(n.id)]))
  const addDescendant = (folderId: string | null, id: string) => {
    for (let f = folderId, guard = 0; f !== null && guard < 10000; guard++) {
      const folder = folders.get(f)
      if (!folder) break
      const list = descendants.get(f) ?? []
      list.push(id)
      descendants.set(f, list)
      f = folder.parentId
    }
  }
  for (const n of notes) {
    const on = noteStates.get(n.id)!
    for (let f = n.folderId, guard = 0; f !== null && guard < 10000; guard++) {
      const folder = folders.get(f)
      if (!folder) break
      const c = under.get(f) ?? { total: 0, on: 0 }
      c.total++
      if (on) c.on++
      under.set(f, c)
      f = folder.parentId
    }
    addDescendant(n.folderId, n.id)
  }
  for (const f of folders.values()) addDescendant(f.parentId, f.id)

  const state = (id: string): CloudState => {
    if (!folders.has(id)) return noteStates.get(id) ? 'on' : 'off'
    const c = under.get(id) ?? { total: 0, on: 0 }
    const rule = folderOn(id)
    if (c.total === 0) return rule ? 'on' : 'off'
    if (rule && c.on === c.total) return 'on'
    if (!rule && c.on === 0) return 'off'
    return 'partial'
  }

  const counts = { total: notes.length, on: 0, stopping: 0, starting: 0 }
  for (const n of notes) {
    const on = noteStates.get(n.id)!
    if (on) counts.on++
    if (n.synced && !on) counts.stopping++
    if (!n.synced && on) counts.starting++
  }
  const allOn = notes.every((n) => noteStates.get(n.id)) && [...folders.keys()].every((id) => folderOn(id))

  return {
    state,
    noteOn: (id) => noteStates.get(id) ?? noteOn(id),
    counts,
    allOn,
    stoppingTitles(limit) {
      const titles = notes.filter((n) => n.synced && !noteStates.get(n.id)).map((n) => n.title.trim() || '未命名')
      return { titles: titles.slice(0, limit), more: Math.max(0, titles.length - limit) }
    },
    toggled(id) {
      const next = new Map(picks)
      if (!folders.has(id)) {
        next.set(id, !noteStates.get(id))
        return next
      }
      const on = state(id) !== 'on'
      next.set(id, on)
      for (const d of descendants.get(id) ?? []) next.set(d, on)
      return next
    },
    allToggled() {
      const on = !allOn
      const next = new Map<string, boolean>()
      for (const id of folders.keys()) next.set(id, on)
      for (const n of notes) next.set(n.id, on)
      return next
    },
    apply() {
      for (const [id, on] of picks) {
        const folder = folders.get(id)
        if (folder && on !== (folder.synced === true)) vault.setFolderSynced(id, on)
      }
      for (const n of vault.listNotes()) {
        const want = noteStates.get(n.id)
        if (want !== undefined && vault.getNote(n.id)?.synced !== want) vault.setNoteSynced(n.id, want)
      }
    },
  }
}
