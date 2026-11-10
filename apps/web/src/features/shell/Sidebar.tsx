import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { useStrip } from '@/hooks/useStrip'
import { navBadge } from '@/lib/strip'
import { count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { AgentsIndicator } from './AgentsIndicator'
import { ClockControl } from './ClockControl'
import { OutageLine } from './OutageLine'
import { UserSwitcher } from './UserSwitcher'
import { NavIcon } from './NavIcon'
import { TourSidebarRow } from '@/features/tour/TourEntry'
import { navFor } from './nav'

/**
 * D1's white sidebar: the brand, the two work queues, a rule, the records; then the demo's own controls kept in
 * one tidy foot (agents, outage, clock, who is signed in), each one click away. Between them, centred, the tour row. The Inbox count is the server's
 * `strip.inbox_open`, the same number as the "Yours" card.
 */
export function Sidebar() {
  const user = useCurrentUser()
  const strip = useStrip()
  const items = navFor(user.role)
  return (
    <aside className="flex w-[208px] flex-none flex-col overflow-y-auto border-r border-line bg-paper px-3 pb-3.5 pt-4">
      <div className="flex items-center gap-2.5 px-1.5 pb-4">
        <BrandMark />
        <span className="flex flex-col">
          <span className="text-md font-semibold tracking-[-0.012em]">TorchRCM</span>
          <span className="text-xs text-soft">Harbor Dental</span>
        </span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-px">
        {items.map((n, i) => {
          const badge = n.badge ? navBadge(strip.data, n.badge) : null
          const rule = i > 0 && items[i - 1]?.group === 'work' && n.group === 'records'
          return (
            <Fragment key={n.to}>
              {rule && <span aria-hidden className="mx-2 my-2 h-px bg-line" />}
              <Link
                to={n.to}
                className="flex h-[34px] items-center gap-2.5 rounded-[7px] px-2 text-base text-mid no-underline hover:bg-hover hover:text-ink"
                activeProps={{ className: 'bg-hover font-medium text-ink!' }}
              >
                <NavIcon to={n.to} />
                {n.label}
                {badge !== null && badge > 0 && (
                  <span
                    data-testid={`badge-${n.badge ?? ''}`}
                    className={cn(
                      'ml-auto min-w-[22px] rounded-full px-1.5 text-center text-xs font-semibold leading-5',
                      n.badge === 'inbox' ? 'bg-practice-bg text-practice-ink' : 'bg-light text-mid',
                    )}
                  >
                    {count(badge)}
                  </span>
                )}
              </Link>
            </Fragment>
          )
        })}
      </nav>
      {/* The tour row takes the free height and sits at its middle: halfway between the nav and the agents line. */}
      <div className="flex flex-1 flex-col justify-center px-1.5 py-5">
        <TourSidebarRow />
      </div>
      <div className="flex flex-col gap-3 px-1.5 text-sm text-mid">
        <AgentsIndicator />
        <OutageLine />
        <div className="flex flex-col gap-2.5 border-t border-line pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-soft" title="Not part of the product: they move the demo’s frozen clock, reset it, and switch who you are">
            Demo controls
          </span>
          <ClockControl />
          <UserSwitcher />
        </div>
      </div>
    </aside>
  )
}

/** A rounded square holding a baton at the practice stop: the product's one idea, at 24px. */
function BrandMark() {
  return (
    <span aria-hidden className="relative inline-block h-6 w-6 rounded-md bg-ink">
      <span className="absolute inset-x-[5px] top-[11px] h-0.5 bg-[#6c7586]" />
      <span className="absolute left-[5px] top-[8.5px] h-[7px] w-2 rounded-full bg-practice" />
    </span>
  )
}
