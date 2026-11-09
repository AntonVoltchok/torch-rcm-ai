import type { MoveCount, MoveWho, StripSummary } from '@/api/schema'
import { Baton, type Party } from '@/components/Baton'
import { STATUS_LABEL } from '@/lib/strip'
import { count, money, plural } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * Three whose-move cards: yours, the agents', the payers'. Each carries a baton at that party's stop, so the
 * header doubles as the legend for every baton below it. Every number is the server's: "Yours" is the viewer's
 * Inbox (`inbox_open`, the same number as the nav count), the other two are `Strip.moves`. They are different
 * units on purpose (items vs claims) and each says its unit; nothing here adds them up.
 */
export function WhoseMoveCards({ strip }: { strip: StripSummary }) {
  const move = (who: MoveWho): MoveCount | undefined => strip.moves.find((m) => m.who === who)
  const agents = move('agents')
  const payer = move('payer')
  return (
    <div className="grid min-w-0 grid-cols-3 gap-3">
      <Card
        who="practice"
        label="Yours"
        n={strip.inbox_open}
        unit={strip.inbox_open === 1 ? 'item' : 'items'}
        sub={`${plural(strip.inbox_claims, 'claim')}, ${plural(strip.inbox_visits, 'upcoming visit')}`}
      />
      <Card who="agents" label="With the agents" n={agents?.count} unit="claims" sub={agents ? byStatus(agents) : undefined} />
      <Card who="payer" label="With payers" n={payer?.count} unit="claims" sub={payer ? `${money(payer.cents)} billed, waiting on a reply` : undefined} />
    </div>
  )
}

const NUM: Record<Party, string> = { practice: 'text-practice-num', agents: 'text-agents-ink', payer: 'text-payer-ink' }

function Card({ who, label, n, unit, sub }: { who: Party; label: string; n: number | undefined; unit: string; sub: string | undefined }) {
  return (
    <section data-move={who} className="panel flex min-w-0 flex-col px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-mid">
        <h2 className="m-0 truncate font-medium">{label}</h2>
        <Baton who={who} decorative />
      </div>
      <p className="m-0 mt-1 flex items-baseline gap-1.5">
        <strong className={cn('nums-proportional text-kpi font-semibold', NUM[who])}>{n === undefined ? '—' : count(n)}</strong>
        <span className="text-sm text-mid">{unit}</span>
      </p>
      <p className={cn('m-0 truncate text-xs text-soft', !sub && 'invisible')}>{sub ?? '—'}</p>
    </section>
  )
}

/** "3 ready, 8 sent": the agents' claims by status, from `MoveCount.by_status`. */
function byStatus(m: MoveCount): string {
  const parts = m.by_status.filter((s) => s.count > 0).map((s) => `${count(s.count)} ${STATUS_LABEL[s.status].toLowerCase()}`)
  return parts.length > 0 ? parts.join(', ') : 'None right now'
}
