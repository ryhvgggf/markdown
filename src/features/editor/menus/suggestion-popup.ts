import type { ComponentType, Ref } from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { isComposingEvent } from '../ime'

export type PopupListHandle = { onKeyDown(e: KeyboardEvent): boolean }

function place(el: HTMLElement, clientRect: SuggestionProps['clientRect']) {
  const rect = clientRect?.()
  if (!rect) return
  void computePosition(
    { getBoundingClientRect: () => rect },
    el,
    { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(6), flip(), shift({ padding: 8 })] },
  ).then(({ x, y }) => {
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
    const mount = (props: SuggestionProps<I, I>) => {
      const p = toProps(props)
      if (renderer) renderer.updateProps(p)
      else {
        renderer = new ReactRenderer(Component as ComponentType<P>, { props: p, editor: props.editor })
        const el = renderer.element as HTMLElement
        el.style.position = 'fixed'
        el.style.zIndex = '60'
        el.style.left = '0'
        el.style.top = '0'
        document.body.appendChild(el)
      }
      place(renderer.element as HTMLElement, props.clientRect)
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
        renderer?.element.remove()
        renderer?.destroy()
        renderer = null
      },
    }
  }
}
