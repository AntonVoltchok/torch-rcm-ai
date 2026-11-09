import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { TOURS } from './registry'
import { toursFor } from './screens'
import { useSeen } from './store'
import { useTour } from './TourProvider'
import type { TourId } from './types'

/**
 * The two ways back into a tour. In the sidebar foot, above the agents line: "Tour this screen" plus a menu of every
 * tour with a check on the ones seen. In each screen's header: a round "?" that starts that screen's tour.
 */
export function TourSidebarRow() {
  const { screenTour, start } = useTour()
  const role = useCurrentUser().role
  const seen = useSeen()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const ids: TourId[] = ['main', ...toursFor(role)]

  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    }
  }

  return (
    <div ref={wrap} className="relative" data-tour="tour-row">
      <div className="flex items-stretch overflow-hidden rounded-[7px] border border-act-line bg-act-bg text-act">
        <button
          type="button"
          onClick={() => start(screenTour ?? 'main')}
          className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm font-medium hover:bg-act hover:text-white"
          title={screenTour ? `Start the ${TOURS[screenTour].name} tour` : 'Start the main tour'}
        >
          <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-current text-[10px] font-semibold">
            ?
          </span>
          Tour this screen
        </button>
        <button
          ref={toggle}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="All tours"
          onClick={() => setOpen((o) => !o)}
          className="border-l border-act-line px-2 text-xs hover:bg-act hover:text-white"
        >
          ▾
        </button>
      </div>
      {open && (
        <div
          role="menu"
          aria-label="Tours"
          onKeyDown={onMenuKey}
          className="absolute bottom-full left-0 z-30 mb-1.5 flex w-[248px] flex-col rounded-lg border border-line bg-paper py-1 text-sm shadow-[0_12px_32px_rgb(22_26_34/0.18)]"
        >
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                start(id)
              }}
              className={cn('flex items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover focus:bg-hover focus:outline-none', id === 'main' && 'border-b border-line pb-2 font-medium')}
            >
              <span aria-hidden className={cn('w-3 flex-none text-ok', !seen[id] && 'invisible')}>
                ✓
              </span>
              <span className="flex-1">{TOURS[id].name}</span>
              {seen[id] && <span className="sr-only">(seen)</span>}
              {id === screenTour && <span className="text-xs text-soft">this screen</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TourHeaderButton() {
  const { screenTour, start } = useTour()
  if (!screenTour) return null
  return (
    <button
      type="button"
      onClick={() => start(screenTour)}
      aria-label={`Tour this screen: ${TOURS[screenTour].name}`}
      title="Tour this screen"
      data-testid="tour-header-button"
      className="grid h-7 w-7 flex-none place-items-center rounded-full border border-line-strong bg-paper text-sm font-semibold text-mid hover:border-ink hover:text-ink"
    >
      ?
    </button>
  )
}
