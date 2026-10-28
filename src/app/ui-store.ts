import { create } from 'zustand'

export type SidebarView = 'tree' | 'trash' | 'attachments'

export interface UiState {
  openNoteId: string | null
  /** The floating 反向連結 panel (summoned by the pill at the card's top right). */
  backlinksOpen: boolean
  /** Pinned: stays open when the pointer leaves and across note switches (per session). */
  backlinksPinned: boolean
  railHover: boolean
  quickSwitcherOpen: boolean
  /** Text the switcher starts with when opened (e.g. '#' from the rail's tag button). */
  quickSwitcherSeed: string
  sidebarOverlayOpen: boolean
  /** What the sidebar card shows: the folder tree, the trash, or the attachments list. */
  sidebarView: SidebarView
  settingsOpen: boolean
  /** The 資料 window (export, import, folder sync, restore, maintenance). */
  dataOpen: boolean
  /** The import dialog: null closed; [] open at the file picker; files: open with those files. */
  importFiles: File[] | null
  highlightBlockId: string | null
  openNote(id: string, blockId?: string): void
  toggleBacklinks(): void
  /** Without `force` (pointer left) a pinned panel stays; `force` (×, Esc) closes and unpins. */
  closeBacklinks(opts?: { force?: boolean }): void
  setBacklinksPinned(v: boolean): void
  setRailHover(v: boolean): void
  setQuickSwitcher(v: boolean, seed?: string): void
  setSidebarOverlay(v: boolean): void
  setSidebarView(v: SidebarView): void
  setSettings(v: boolean): void
  setData(v: boolean): void
  openImport(files?: File[]): void
  closeImport(): void
  clearHighlight(): void
}

export function createUiStore(deps: { persistLastNote?: (id: string) => void } = {}) {
  return create<UiState>((set) => ({
    openNoteId: null,
    backlinksOpen: false,
    backlinksPinned: false,
    railHover: false,
    quickSwitcherOpen: false,
    quickSwitcherSeed: '',
    sidebarOverlayOpen: false,
    sidebarView: 'tree',
    settingsOpen: false,
    dataOpen: false,
    importFiles: null,
    highlightBlockId: null,
    openNote: (id, blockId) => {
      set((s) => ({ openNoteId: id, highlightBlockId: blockId ?? null, backlinksOpen: s.backlinksOpen && s.backlinksPinned }))
      deps.persistLastNote?.(id)
    },
    toggleBacklinks: () => set((s) => (s.backlinksOpen ? { backlinksOpen: false, backlinksPinned: false } : { backlinksOpen: true })),
    closeBacklinks: (opts) =>
      set((s) => (opts?.force ? { backlinksOpen: false, backlinksPinned: false } : s.backlinksPinned ? s : { backlinksOpen: false })),
    setBacklinksPinned: (backlinksPinned) => set({ backlinksPinned }),
    setRailHover: (railHover) => set({ railHover }),
    setQuickSwitcher: (quickSwitcherOpen, seed = '') => set({ quickSwitcherOpen, quickSwitcherSeed: seed }),
    setSidebarOverlay: (sidebarOverlayOpen) => set({ sidebarOverlayOpen }),
    setSidebarView: (sidebarView) => set({ sidebarView }),
    setSettings: (settingsOpen) => set({ settingsOpen }),
    setData: (dataOpen) => set({ dataOpen }),
    openImport: (files = []) => set({ importFiles: files }),
    closeImport: () => set({ importFiles: null }),
    clearHighlight: () => set({ highlightBlockId: null }),
  }))
}

/** Closes the settings and 資料 windows (e.g. before showing a note). */
export const closeDataWindows = () => useUi.setState({ settingsOpen: false, dataOpen: false })

let persistHook: ((id: string) => void) | undefined
/** Wired by App after bootstrap so openNote persists meta.lastNoteId. */
export function setPersistLastNote(fn: ((id: string) => void) | undefined): void {
  persistHook = fn
}

export const useUi = createUiStore({ persistLastNote: (id) => persistHook?.(id) })
