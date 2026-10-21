import * as DM from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'

function Item({ className = '', ...rest }: ComponentPropsWithoutRef<typeof DM.Item>) {
  return (
    <DM.Item
      className={`flex cursor-default items-center gap-2 rounded-control px-2.5 py-1.5 text-base text-fg outline-none data-[highlighted]:bg-fill data-[disabled]:opacity-50 ${className}`}
      {...rest}
    />
  )
}

function Separator() {
  return <DM.Separator className="my-1 h-px bg-fill" />
}

export function Menu({
  trigger,
  children,
  align = 'end',
  onOpenChange,
  onCloseAutoFocus,
}: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  return (
    <DM.Root onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} onCloseAutoFocus={onCloseAutoFocus} sideOffset={6} className="glass-float z-50 min-w-40 p-1">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

Menu.Item = Item
Menu.Separator = Separator

function Sub({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <DM.Sub>
      <DM.SubTrigger className="flex cursor-default items-center gap-2 rounded-control px-2.5 py-1.5 text-base text-fg outline-none data-[highlighted]:bg-fill data-[state=open]:bg-fill">
        {label}
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent sideOffset={6} className="glass-float z-50 min-w-40 p-1">
          {children}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  )
}

Menu.Sub = Sub
