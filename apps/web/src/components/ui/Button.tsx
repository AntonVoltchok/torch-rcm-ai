import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'default' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-acc border-acc text-white hover:bg-acc-dark hover:border-acc-dark',
  default: 'bg-white border-[#b7bbc2] text-ink hover:bg-fill',
  ghost: 'bg-transparent border-transparent text-mid hover:text-ink hover:bg-fill',
  danger: 'bg-white border-bad-line text-bad hover:bg-bad-bg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  kbd?: string
}

export function Button({ variant = 'default', size = 'md', kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-base',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <kbd className={cn('ml-0.5 rounded border px-1 font-mono text-2xs font-normal', variant === 'primary' ? 'border-white/40 text-white/80' : 'border-line text-soft')}>{kbd}</kbd>}
    </button>
  )
}
