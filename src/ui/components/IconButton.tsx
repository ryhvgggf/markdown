import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { focusRing } from './Button'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  tooltip?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip = false, tooltipSide, type = 'button', className = '', onFocus, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`inline-flex size-7 items-center justify-center rounded-control text-fg-secondary transition duration-200 ease-spring hover:bg-fill hover:text-fg disabled:opacity-50 ${focusRing} ${className}`}
      onFocus={(e) => {
        onFocus?.(e)
        if (e.defaultPrevented || !tooltip) return
        // A closed dialog restores focus to the button that opened it via a programmatic focus() call, not
        // real keyboard navigation (same distinction Rail.tsx's own onFocus fix makes) — Radix's Tooltip
        // opens on focus same as hover, and a focus restored this way never gets a pointerleave/blur to
        // close it again, so without this it's left stuck open until the user clicks elsewhere.
        let keyboardFocus = false
        try {
          keyboardFocus = e.target.matches(':focus-visible')
        } catch {
          // :focus-visible unsupported
        }
        if (!keyboardFocus) e.preventDefault()
      }}
      {...rest}
    />
  )
  return tooltip ? (
    <Tooltip content={label} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : button
})
