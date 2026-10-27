import * as RD from '@radix-ui/react-dialog'
import type { ReactElement, ReactNode } from 'react'

export interface DialogProps {
  title: string
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  description?: string
  /** Top-anchored 560px command-palette layout with a visually hidden title. */
  palette?: boolean
  /** Large two-pane layout (settings): no padding, content fills the dialog. */
  settings?: boolean
  onCloseAutoFocus?: (e: Event) => void
  children: ReactNode
}

export function Dialog({ title, trigger, description, palette, settings, onCloseAutoFocus, children, ...state }: DialogProps) {
  return (
    <RD.Root {...state}>
      {trigger && <RD.Trigger asChild>{trigger}</RD.Trigger>}
      <RD.Portal>
        <RD.Overlay className="dialog-scrim fixed inset-0 z-40 bg-black/15" />
        <RD.Content
          onCloseAutoFocus={onCloseAutoFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={
            palette
              ? 'glass-float dialog-pop fixed top-[110px] left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden outline-none'
              : settings
                ? 'glass-float dialog-pop fixed top-1/2 left-1/2 z-50 flex h-[min(88vh,520px)] w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden outline-none'
                : 'glass-float dialog-pop fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 p-5 outline-none'
          }
        >
          <RD.Title className={palette ? 'sr-only' : settings ? 'px-6 pt-5 text-md font-semibold text-fg' : 'text-md font-semibold text-fg'}>{title}</RD.Title>
          {description && (
            <RD.Description className="mt-1 text-sm text-fg-secondary">{description}</RD.Description>
          )}
          <div className={palette ? undefined : settings ? 'mt-2 flex min-h-0 flex-1 flex-col' : 'mt-3'}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
