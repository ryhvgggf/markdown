import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    // disableHoverableContent: the tooltip closes the moment the pointer leaves its trigger (never lingers when
    // the pointer passes over it); Radix also closes it on pointerdown.
    <RadixTooltip.Provider delayDuration={400} disableHoverableContent>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={side === 'right' ? 8 : 6}
            className="glass-float tooltip-pop z-50 !rounded-[9px] px-2.5 py-1 text-xs text-fg"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
