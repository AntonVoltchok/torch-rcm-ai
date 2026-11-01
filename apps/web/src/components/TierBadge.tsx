import type { RuleMode, Tier } from '@/api/schema'
import { cn } from '@/lib/cn'

const TIER_LABEL: Record<Tier, string> = { 1: 'Talks to payers', 2: 'Touches ledger or patients', 3: 'Commits the practice' }
const MODE_LABEL: Record<RuleMode, string> = { observe: 'Observe', ask: 'Ask', auto: 'Runs without review', human_only: 'Human only' }

export function TierBadge({ tier, mode, compact = false }: { tier: Tier; mode?: RuleMode | undefined; compact?: boolean }) {
  return (
    <span
      title={`Tier ${tier}: ${TIER_LABEL[tier]}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 text-2xs font-bold leading-[17px]',
        tier === 1 && 'border-acc-line bg-acc-bg text-acc',
        tier === 2 && 'border-warn-line bg-warn-bg text-warn',
        tier === 3 && 'border-ink bg-ink text-white',
      )}
    >
      T{tier}
      {!compact && <span className="font-semibold">· {TIER_LABEL[tier]}</span>}
      {mode && <span className="font-semibold">· {MODE_LABEL[mode]}</span>}
    </span>
  )
}
