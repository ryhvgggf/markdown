import type { Vault } from '@/core/vault/vault'

/** What a row's cloud shows while choosing what to sync: all synced, none, or some of a folder's notes. A folder is only a shortcut for the notes in it. */
export type CloudState = 'on' | 'off' | 'partial'

export interface SelectionModel {
  /** The cloud state of a note or folder row. */
  state(id: string): CloudState
  /** The state a note ends up in (its own pick wins, else it stays as it is). */
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
  /** Applies the picks to the vault: the notes that end up different. */
  apply(): void
}

/**
 * The 同步到雲端 selection (3f-5): which notes are ticked, built from what the vault has now and the clicks made
 * so far (`picks`: note id → the state clicked into). Pure; the sidebar renders from it and applies it. Sync is
 * decided per note: a folder row only ticks or unticks every note under it (there is no folder rule, so notes
 * put into a folder later are not synced by it).
 */
export function createSelectionModel(vault: Vault, picks: ReadonlyMap<string, boolean>): SelectionModel {
  const folders = new Map(vault.listFolders().map((f) => [f.id, f]))
  const notes = vault.listNotes()
  const noteOn = (id: string): boolean => picks.get(id) ?? vault.getNote(id)?.synced === true

  // Per folder: how many live notes lie anywhere under it, how many of those are on, and which they are.
  const under = new Map<string, { ids: string[]; on: number }>()
  const noteStates = new Map(notes.map((n) => [n.id, noteOn(n.id)]))
  for (const n of notes) {
    const on = noteStates.get(n.id)!
    for (let f = n.folderId, guard = 0; f !== null && guard < 10000; guard++) {
      const folder = folders.get(f)
      if (!folder) break
      const c = under.get(f) ?? { ids: [], on: 0 }
      c.ids.push(n.id)
      if (on) c.on++
      under.set(f, c)
      f = folder.parentId
    }
  }

  const state = (id: string): CloudState => {
    if (!folders.has(id)) return noteStates.get(id) ? 'on' : 'off'
    const c = under.get(id)
    if (!c || c.on === 0) return 'off'
    return c.on === c.ids.length ? 'on' : 'partial'
  }

  const counts = { total: notes.length, on: 0, stopping: 0, starting: 0 }
  for (const n of notes) {
    const on = noteStates.get(n.id)!
    if (on) counts.on++
    if (n.synced && !on) counts.stopping++
    if (!n.synced && on) counts.starting++
  }
  const allOn = notes.every((n) => noteStates.get(n.id))

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
      for (const d of under.get(id)?.ids ?? []) next.set(d, on)
      return next
    },
    allToggled() {
      const on = !allOn
      return new Map(notes.map((n) => [n.id, on]))
    },
    apply() {
      for (const n of vault.listNotes()) {
        const want = noteStates.get(n.id)
        if (want !== undefined && vault.getNote(n.id)?.synced !== want) vault.setNoteSynced(n.id, want)
      }
    },
  }
}
