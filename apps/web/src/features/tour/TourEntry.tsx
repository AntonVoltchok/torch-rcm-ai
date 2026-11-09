import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { TOURS } from './registry'
import { toursFor } from './screens'
import { useSeen } from './store'
import { useTour } from './TourProvider'
import type { TourId } from './types'

/**
 * The two ways back into a tour. In the sidebar, centred between the nav and the agents line and solid so it cannot be
 * missed: "Tour this screen" plus a menu of every tour with a check on the ones seen. In each screen's header: a round "?" that starts that screen's tour.
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
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      ;(e.key === 'Home' ? items[0] : items.at(-1))?.focus()
    }
  }

  return (
    <div ref={wrap} className="relative" data-tour="tour-row">
      <div className="flex items-stretch overflow-hidden rounded-[7px] border border-act bg-act text-white">
        <button
          type="button"
          onClick={() => start(screenTour ?? 'main')}
          className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm font-medium hover:bg-act-hover"
          title={screenTour ? `Start the ${TOURS[screenTour].name} tour` : 'Start the main tour'}
        >
          <HelpIcon />
          Tour this screen
        </button>
        <button
          ref={toggle}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'tour-menu' : undefined}
          aria-label="All tours"
          onClick={() => setOpen((o) => !o)}
          className="border-l border-white/30 px-2 text-xs hover:bg-act-hover"
        >
          ▾
        </button>
      </div>
      {open && (
        <div
          id="tour-menu"
          role="menu"
          aria-label="Tours"
          onKeyDown={onMenuKey}
          className="absolute bottom-full left-0 right-0 z-30 mb-1.5 flex flex-col rounded-lg border border-line bg-paper py-1 text-sm shadow-[0_12px_32px_rgb(22_26_34/0.18)]"
        >
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                start(id, toggle.current)
              }}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-left text-ink hover:bg-hover focus:bg-hover focus:outline-none', id === 'main' && 'border-b border-line pb-2 font-medium')}
            >
              <span aria-hidden className={cn('w-3 flex-none text-ok', !seen[id] && 'invisible')}>
                ✓
              </span>
              <span className="flex-1">{TOURS[id].name}</span>
              {seen[id] && <span className="sr-only">(seen)</span>}
              {id === screenTour && (
                <span className="text-xs text-soft" title="This screen">
                  here
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A "?" in a circle, drawn rather than typed so the glyph sits at the circle's centre whatever the font's metrics. */
function HelpIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="7.1" />
      <path d="M6.1 5.85a1.95 1.95 0 0 1 3.8.6c0 1.3-1.9 1.6-1.9 2.7" />
      <circle cx="8" cy="11.25" r="0.2" strokeWidth="1.2" />
    </svg>
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
