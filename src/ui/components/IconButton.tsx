import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { focusRing } from './Button'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  tooltip?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip = false, tooltipSide, type = 'button', className = '', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`inline-flex size-7 items-center justify-center rounded-control text-fg-secondary transition duration-200 ease-spring hover:bg-fill hover:text-fg disabled:opacity-50 ${focusRing} ${className}`}
      {...rest}
    />
  )
  return tooltip ? (
    <Tooltip content={label} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : button
})
