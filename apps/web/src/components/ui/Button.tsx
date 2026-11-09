import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** D1 buttons. `primary` is the one action colour (cobalt); everything else is a neutral line or a quiet text button. */
type Variant = 'primary' | 'default' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-act border-act text-white shadow-[0_1px_2px_rgb(42_85_214/0.24)] hover:bg-act-hover hover:border-act-hover',
  default: 'bg-paper border-line-strong text-ink hover:bg-hover',
  ghost: 'bg-transparent border-transparent text-mid hover:text-ink hover:bg-hover',
  danger: 'bg-paper border-risk-line text-risk-ink hover:bg-risk-bg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  kbd?: string
}

const SIZE = { sm: 'h-7 px-2.5 text-sm rounded-md', md: 'h-8 px-3 text-base rounded-lg', lg: 'h-10 px-4 text-base rounded-lg' }

export function Button({ variant = 'default', size = 'md', kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'font-semibold',
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && (
        <kbd
          className={cn(
            'rounded px-1.5 py-0.5 font-sans text-xs font-medium leading-none',
            variant === 'primary' ? 'bg-[rgb(10_20_60/0.28)] text-white' : 'border border-line bg-hover text-mid',
          )}
        >
          {kbd}
        </kbd>
      )}
    </button>
  )
}
