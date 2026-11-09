import type { RuleMode, Tier } from '@/api/schema'
import { cn } from '@/lib/cn'

const TIER_LABEL: Record<Tier, string> = { 1: 'Talks to payers', 2: 'Touches ledger or patients', 3: 'Commits the practice' }
const MODE_LABEL: Record<RuleMode, string> = { observe: 'Observe', ask: 'Ask', auto: 'Runs without review', human_only: 'Human only' }

export function TierBadge({ tier, mode, compact = false }: { tier: Tier; mode?: RuleMode | undefined; compact?: boolean }) {
  return (
    <span
      title={`Tier ${tier}: ${TIER_LABEL[tier]}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs font-semibold leading-[18px]',
        // Weight, not hue: cobalt is for actions and amber is "yours". T1 quiet, T2 outlined, T3 solid.
        tier === 1 && 'border-transparent bg-light text-mid',
        tier === 2 && 'border-line-strong bg-paper text-ink',
        tier === 3 && 'border-ink bg-ink text-white',
      )}
    >
      T{tier}
      {!compact && <span className="font-medium">· {TIER_LABEL[tier]}</span>}
      {mode && <span className="font-medium">· {MODE_LABEL[mode]}</span>}
    </span>
  )
}
