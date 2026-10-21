import { create } from 'zustand'

export type Panel = 'none' | 'outline' | 'backlinks'

export interface UiState {
  openNoteId: string | null
  panel: Panel
  railHover: boolean
  quickSwitcherOpen: boolean
  sidebarOverlayOpen: boolean
  settingsOpen: boolean
  highlightBlockId: string | null
  openNote(id: string, blockId?: string): void
  setPanel(p: Panel): void
  togglePanel(p: Exclude<Panel, 'none'>): void
  setRailHover(v: boolean): void
  setQuickSwitcher(v: boolean): void
  setSidebarOverlay(v: boolean): void
  setSettings(v: boolean): void
  clearHighlight(): void
}

export function createUiStore(deps: { persistLastNote?: (id: string) => void } = {}) {
  return create<UiState>((set) => ({
    openNoteId: null,
    panel: 'none',
    railHover: false,
    quickSwitcherOpen: false,
    sidebarOverlayOpen: false,
    settingsOpen: false,
    highlightBlockId: null,
    openNote: (id, blockId) => {
      set({ openNoteId: id, highlightBlockId: blockId ?? null })
      deps.persistLastNote?.(id)
    },
    setPanel: (panel) => set({ panel }),
    togglePanel: (p) => set((s) => ({ panel: s.panel === p ? 'none' : p })),
    setRailHover: (railHover) => set({ railHover }),
    setQuickSwitcher: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
    setSidebarOverlay: (sidebarOverlayOpen) => set({ sidebarOverlayOpen }),
    setSettings: (settingsOpen) => set({ settingsOpen }),
    clearHighlight: () => set({ highlightBlockId: null }),
  }))
}

let persistHook: ((id: string) => void) | undefined
/** Wired by App after bootstrap so openNote persists meta.lastNoteId. */
export function setPersistLastNote(fn: ((id: string) => void) | undefined): void {
  persistHook = fn
}

export const useUi = createUiStore({ persistLastNote: (id) => persistHook?.(id) })
