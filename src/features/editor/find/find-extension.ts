import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findAllMatches, type Match } from './find-match'

export interface FindState {
  open: boolean
  query: string
  matches: Match[]
  /** Index into `matches`, or -1 when there are none. */
  current: number
}

const INITIAL: FindState = { open: false, query: '', matches: [], current: -1 }
const findKey = new PluginKey<FindState>('findReplace')

function read(state: EditorState): FindState {
  return findKey.getState(state) ?? INITIAL
}

/** Reads the find bar's current state straight from the editor — for the FindBar component to subscribe to. */
export function getFindState(editor: Editor): FindState {
  return read(editor.state)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      openFind: () => ReturnType
      closeFind: () => ReturnType
      toggleFind: () => ReturnType
      setFindQuery: (query: string) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
    }
  }
}

function step(state: FindState, current: number): FindState {
  if (!state.matches.length) return state
  const n = state.matches.length
  return { ...state, current: ((current % n) + n) % n }
}

/**
 * Bounded editor feature (phase 3 design doc has no entry — this is an unrelated UI feature): find
 * within the current note, Ctrl/Cmd+F. `applyToAllMatches` (apply.ts) does the actual replace/reformat;
 * this extension only tracks the query, the match list, and which one is "current" for highlighting.
 */
export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => INITIAL,
          apply(tr, value) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
            let next = meta ? { ...value, ...meta } : value
            if (tr.docChanged && next.query) {
              const matches = findAllMatches(tr.doc, next.query)
              next = { ...next, matches, current: matches.length ? Math.min(Math.max(next.current, 0), matches.length - 1) : -1 }
            }
            return next
          },
        },
        props: {
          decorations(state) {
            const { matches, current } = findKey.getState(state) ?? INITIAL
            if (!matches.length) return null
            return DecorationSet.create(
              state.doc,
              matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-match find-match-current' : 'find-match' })),
            )
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => this.editor.commands.toggleFind(),
      Escape: () => (getFindState(this.editor).open ? this.editor.commands.closeFind() : false),
    }
  },

  addCommands() {
    return {
      openFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findKey, { open: true }).setMeta('addToHistory', false)
          return true
        },
      closeFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findKey, INITIAL).setMeta('addToHistory', false)
          return true
        },
      toggleFind:
        () =>
        ({ state, tr, dispatch }) => {
          const open = !read(state).open
          if (dispatch) tr.setMeta(findKey, open ? { open: true } : INITIAL).setMeta('addToHistory', false)
          return true
        },
      setFindQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const matches = findAllMatches(tr.doc, query)
            tr.setMeta(findKey, { query, matches, current: matches.length ? 0 : -1 }).setMeta('addToHistory', false)
          }
          return true
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const st = read(state)
          if (!st.matches.length) return false
          if (dispatch) tr.setMeta(findKey, step(st, st.current + 1)).setMeta('addToHistory', false)
          return true
        },
      findPrev:
        () =>
        ({ state, tr, dispatch }) => {
          const st = read(state)
          if (!st.matches.length) return false
          if (dispatch) tr.setMeta(findKey, step(st, st.current - 1)).setMeta('addToHistory', false)
          return true
        },
    }
  },
})
