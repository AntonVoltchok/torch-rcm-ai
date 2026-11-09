/**
 * The ten screens, in nav order. The sidebar is built from this table and route guards read the same role lists,
 * so the nav never shows a link that would redirect. D1 puts the two work queues (Inbox, Denials) first, then a
 * rule, then the records.
 */
import type { Role } from '@/api/schema'
import type { NavBadgeKey } from '@/lib/strip'

export interface NavItem {
  to: '/inbox' | '/ledger' | '/claims' | '/denials' | '/payments' | '/patients' | '/eligibility' | '/activity' | '/cash' | '/settings/agents'
  label: string
  roles: readonly Role[]
  badge?: NavBadgeKey
  status?: 'interactive' | 'static' | 'mock'
  /** `work` is drawn above the rule. */
  group: 'work' | 'records'
}

const ALL: readonly Role[] = ['owner', 'billing', 'dentist', 'front_desk']

export const NAV: readonly NavItem[] = [
  { to: '/inbox', label: 'Inbox', roles: ALL, badge: 'inbox', status: 'interactive', group: 'work' },
  { to: '/denials', label: 'Denials', roles: ['owner', 'billing', 'dentist'], status: 'static', group: 'work' },
  { to: '/ledger', label: 'Today’s claims', roles: ['owner', 'billing', 'front_desk'], status: 'static', group: 'records' },
  { to: '/claims', label: 'Claims', roles: ALL, status: 'interactive', group: 'records' },
  { to: '/payments', label: 'Payments', roles: ['owner', 'billing'], badge: 'payments', status: 'mock', group: 'records' },
  { to: '/patients', label: 'Patients', roles: ['owner', 'billing', 'front_desk'], status: 'mock', group: 'records' },
  { to: '/eligibility', label: 'Eligibility', roles: ['owner', 'billing', 'front_desk'], badge: 'eligibility', status: 'static', group: 'records' },
  { to: '/activity', label: 'Activity', roles: ['owner', 'billing', 'front_desk'], badge: 'activity', status: 'static', group: 'records' },
  { to: '/cash', label: 'Cash', roles: ['owner'], status: 'static', group: 'records' },
  // Billing reads and proposes (a tier-2 change becomes Dr. Morgan's sign-off item); the owner signs. Mocks, eng note 8.
  { to: '/settings/agents', label: 'Settings', roles: ['owner', 'billing'], status: 'interactive', group: 'records' },
]

export const navFor = (role: Role) => NAV.filter((n) => n.roles.includes(role))
export const allowed = (path: NavItem['to'], role: Role) => NAV.find((n) => n.to === path)?.roles.includes(role) ?? true
