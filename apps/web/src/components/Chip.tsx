import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** D1's status pill: neutral grey by default; red only for money at risk, green only for money in. */
export type ChipTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'acc' | 'ink' | 'dashed'
const TONE: Record<ChipTone, string> = {
  neutral: 'bg-light text-mid border-transparent',
  ok: 'bg-ok-bg text-ok border-transparent',
  warn: 'bg-warn-bg text-warn border-warn-line',
  bad: 'bg-risk-bg text-risk-ink border-transparent',
  acc: 'bg-act-bg text-act border-transparent',
  ink: 'bg-ink text-white border-ink',
  dashed: 'bg-paper text-mid border-soft border-dashed',
}

export function Chip({ tone = 'neutral', children, className, title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-block whitespace-nowrap rounded-full border px-2 text-xs font-medium leading-[18px]', TONE[tone], className)}>
      {children}
    </span>
  )
}
