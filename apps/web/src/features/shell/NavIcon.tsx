import type { NavItem } from './nav'

/** 20×20 line icons from the D1 prototype (Cash added in the same hand). Decorative: the label names the link. */
const PATHS: Record<NavItem['to'], string> = {
  '/inbox': 'M3 11.5 5.2 4.6A1 1 0 0 1 6.1 4h7.8a1 1 0 0 1 .9.6l2.2 6.9V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 11.5h4l1 2h4l1-2h4',
  '/denials': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM7.5 7.5l5 5m0-5-5 5',
  '/ledger': 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5zM3.5 8.5h13M7 3v3m6-3v3m-5.5 6.5 1.8 1.6 3.2-3.2',
  '/claims': 'M5 3.5h6.5L15 7v9a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 16zM11.5 3.5V7H15M7.5 10.5h5m-5 3h5',
  '/payments': 'M4 5h12a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V6.5A1.5 1.5 0 0 1 4 5zM2.5 8.5h15m-12 4h3',
  '/patients': 'M11 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM2.8 16c.6-2.8 2.6-4.2 5.2-4.2s4.6 1.4 5.2 4.2M13 4.3a3 3 0 0 1 0 5.4m1.6 2.4c1.4.6 2.3 1.9 2.6 3.9',
  '/eligibility': 'm10 3 5.5 2v4.5c0 3.4-2.2 6-5.5 7.3-3.3-1.3-5.5-3.9-5.5-7.3V5zM7.5 10l1.8 1.8 3.2-3.4',
  '/activity': 'M2.5 10.5h3.2l2-6 4.4 11 2-5h3.4',
  '/cash': 'M3.5 16.5h13M5.5 13.5v-4m4 4v-8m4 8v-6',
  '/settings/agents': 'M3.5 6h8m4 0h1M3.5 14h1m4 0h8M15.5 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8.5 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
}

export function NavIcon({ to }: { to: NavItem['to'] }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px] flex-none fill-none stroke-current" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[to]} />
    </svg>
  )
}
