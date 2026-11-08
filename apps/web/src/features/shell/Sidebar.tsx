import { Link } from '@tanstack/react-router'
import { useStrip } from '@/hooks/useStrip'
import { navBadge } from '@/lib/strip'
import { count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { AgentsIndicator } from './AgentsIndicator'
import { ClockControl } from './ClockControl'
import { UserSwitcher } from './UserSwitcher'
import { navFor } from './nav'

export function Sidebar() {
  const user = useCurrentUser()
  const strip = useStrip()
  return (
    <aside className="flex w-[184px] flex-none flex-col gap-0.5 border-r border-line bg-fill px-2.5 py-3.5">
      <div className="flex items-center gap-2 px-2 pb-3.5 text-[17px] font-extrabold">
        <i aria-hidden className="inline-block h-[18px] w-[18px] rounded-[5px_5px_9px_9px] bg-ink" />
        TorchRCM
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {navFor(user.role).map((n) => {
          const badge = n.badge ? navBadge(strip.data, n.badge) : null
          return (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center rounded-md border border-transparent px-2 py-[7px] text-[13.5px] text-mid no-underline hover:text-ink"
              activeProps={{ className: 'border-line! bg-white font-bold text-ink!' }}
            >
              {n.label}
              {badge !== null && badge > 0 && (
                <span
                  data-testid={`badge-${n.badge ?? ''}`}
                  className={cn('ml-auto rounded-[9px] px-[7px] text-2xs font-bold', n.badge === 'inbox' ? 'bg-acc text-white' : 'bg-light text-mid')}
                >
                  {count(badge)}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <div className="flex-1" />
      <div className="flex flex-col gap-2 border-t border-line pt-2.5 text-xs text-mid">
        <AgentsIndicator />
        <UserSwitcher />
        <ClockControl />
      </div>
    </aside>
  )
}
