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
  onCloseAutoFocus?: (e: Event) => void
  children: ReactNode
}

export function Dialog({ title, trigger, description, palette, onCloseAutoFocus, children, ...state }: DialogProps) {
  return (
    <RD.Root {...state}>
      {trigger && <RD.Trigger asChild>{trigger}</RD.Trigger>}
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <RD.Content
          onCloseAutoFocus={onCloseAutoFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={
            palette
              ? 'glass-float fixed top-[110px] left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden outline-none'
              : 'glass-float fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 p-5 outline-none'
          }
        >
          <RD.Title className={palette ? 'sr-only' : 'text-md font-semibold text-fg'}>{title}</RD.Title>
          {description && (
            <RD.Description className="mt-1 text-sm text-fg-secondary">{description}</RD.Description>
          )}
          <div className={palette ? undefined : 'mt-3'}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
