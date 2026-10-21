import type { ReactNode } from 'react'
import { Close } from '../icons'
import { IconButton } from './IconButton'

export type BannerTone = 'info' | 'warning' | 'error'

const TONE: Record<BannerTone, string> = {
  info: 'bg-fill text-fg',
  warning: 'bg-amber-100 text-amber-950',
  error: 'bg-red-100 text-red-950',
}

export function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: BannerTone
  onDismiss?: () => void
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={`flex items-center gap-3 px-4 py-2 text-sm ${TONE[tone]}`}
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <IconButton label="關閉" onClick={onDismiss}>
          <Close size={14} />
        </IconButton>
      )}
    </div>
  )
}
