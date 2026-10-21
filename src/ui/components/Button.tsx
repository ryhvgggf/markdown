import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'bg-fill text-fg hover:bg-black/10',
  ghost: 'bg-transparent text-fg hover:bg-fill',
}

export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', type = 'button', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-control px-3 text-base font-medium transition duration-200 ease-spring disabled:opacity-50 ${focusRing} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
})
