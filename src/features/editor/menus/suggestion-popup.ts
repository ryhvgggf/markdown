import type { ComponentType, Ref } from 'react'
import { ReactRenderer } from '@tiptap/react'
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Extension } from '@tiptap/core'
import { Plugin, type EditorState } from '@tiptap/pm/state'
import { isComposingEvent } from '../ime'

/** Keys an open suggestion popup owns: they never reach the document (caret, lists, tables, title navigation). */
const POPUP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'Esc'])

type SuggestionState = { active: boolean; range: unknown; query: unknown }
const isSuggestionState = (s: unknown): s is SuggestionState =>
  typeof s === 'object' && s !== null && 'active' in s && 'range' in s && 'query' in s

/** The plugin of the open `@tiptap/suggestion` popup (slash, `[[`, any later one), if any. */
export function activeSuggestion(state: EditorState): Plugin | undefined {
  return state.plugins.find((p) => {
    const s: unknown = p.getState(state)
    return isSuggestionState(s) && s.active
  })
}

/**
 * Runs before every other key handler (list Tab / Alt-Shift-arrows, table Tab, title navigation…):
 * while a suggestion popup is open, its navigation keys go to that popup and are always consumed.
 * Never during an IME composition.
 */
export const SuggestionKeys = Extension.create({
  name: 'suggestionKeys',
  priority: 10000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (!POPUP_KEYS.has(event.key) || isComposingEvent(event, view)) return false
            const plugin = activeSuggestion(view.state)
            if (!plugin) return false
            const handled = plugin.props.handleKeyDown?.call(plugin, view, event)
            // Enter with nothing to pick closes the popup (it never splits the line underneath).
            if (!handled && event.key === 'Enter' && plugin.spec.key) exitSuggestion(view, plugin.spec.key)
            return true
          },
        },
      }),
    ]
  },
})

export type PopupListHandle = { onKeyDown(e: KeyboardEvent): boolean }

/**
 * Positions `el` against the live caret rect returned by `getRect`, flipping above the caret
 * (or shifting within the viewport) when there isn't room below/to the side. `padding: 8` keeps
 * an 8px gap from the viewport edge so the popup never touches it.
 */
function place(el: HTMLElement, getRect: () => DOMRect | null) {
  const rect = getRect()
  if (!rect) return
  void computePosition({ getBoundingClientRect: () => rect }, el, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })
}

/**
 * Suggestion `render()` that mounts a React list in a fixed popup under the caret.
 * `toProps` maps the suggestion props to the list's props. Keys go to the list's ref
 * handle, except while an IME composition is in progress.
 */
export function suggestionPopup<I, P extends object>(
  Component: ComponentType<P & { ref?: Ref<PopupListHandle> }>,
  toProps: (props: SuggestionProps<I, I>) => P,
) {
  return () => {
    let renderer: ReactRenderer<PopupListHandle, P> | null = null
    let rect: DOMRect | null = null
    const getRect = () => rect
    let stopAutoUpdate: (() => void) | undefined
    const mount = (props: SuggestionProps<I, I>) => {
      const p = toProps(props)
      rect = props.clientRect?.() ?? null
      if (renderer) renderer.updateProps(p)
      else {
        renderer = new ReactRenderer(Component as ComponentType<P>, { props: p, editor: props.editor })
        const el = renderer.element as HTMLElement
        el.style.position = 'fixed'
        el.style.zIndex = '60'
        el.style.left = '0'
        el.style.top = '0'
        document.body.appendChild(el)
        // React can mount the list a tick after this (async root), and its item count — so its height —
        // can change on every query. autoUpdate's ResizeObserver on `el` re-runs placement whenever that
        // happens (and on scroll/viewport resize), so a popup that only now grew past the bottom edge
        // still gets flipped above the caret instead of being left to spill off-screen.
        stopAutoUpdate = autoUpdate({ getBoundingClientRect: () => getRect() ?? new DOMRect() }, el, () => place(el, getRect))
      }
      place(renderer.element as HTMLElement, getRect)
    }
    return {
      onStart: mount,
      onUpdate: mount,
      // Esc during composition is handled by ProseMirror's composition filter before the suggestion plugin sees it.
      onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
        if (isComposingEvent(event, view)) return false
        return renderer?.ref?.onKeyDown(event) ?? false
      },
      onExit: () => {
        stopAutoUpdate?.()
        stopAutoUpdate = undefined
        renderer?.element.remove()
        renderer?.destroy()
        renderer = null
      },
    }
  }
}
