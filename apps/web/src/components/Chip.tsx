import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'acc' | 'ink' | 'dashed'
const TONE: Record<ChipTone, string> = {
  neutral: 'bg-white text-mid border-line',
  ok: 'bg-ok-bg text-ok border-ok-line',
  warn: 'bg-warn-bg text-warn border-warn-line',
  bad: 'bg-bad-bg text-bad border-bad-line',
  acc: 'bg-acc-bg text-acc border-acc-line',
  ink: 'bg-ink text-white border-ink',
  dashed: 'bg-white text-mid border-soft border-dashed',
}

export function Chip({ tone = 'neutral', children, className, title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-block whitespace-nowrap rounded-[10px] border px-[7px] text-2xs font-semibold leading-[17px]', TONE[tone], className)}>
      {children}
    </span>
  )
}
