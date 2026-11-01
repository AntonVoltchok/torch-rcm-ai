/**
 * Every TanStack Query key in the app. Keys are hierarchical so one `invalidateQueries({queryKey: k.inbox.all})`
 * reaches lists and items. `['strip']` is written by the API client from `meta.counts`, never by components.
 */
import type { ClaimsApiParams } from '@/features/claims/search'
import type { ActivityParams, PreviewParams } from './endpoints'

type Loc = string | undefined

export const qk = {
  strip: (location: Loc) => ['strip', { location }] as const,
  stripAll: ['strip'] as const,
  clock: ['clock'] as const,
  advance: (id: string) => ['advance', id] as const,
  agents: ['agents'] as const,
  world: ['world'] as const,
  inbox: {
    all: ['inbox'] as const,
    lists: () => ['inbox', 'list'] as const,
    list: (p: { state: string; kind?: string | undefined; agent?: string | undefined; location: Loc }) => ['inbox', 'list', p] as const,
    item: (id: string) => ['inbox', 'item', id] as const,
  },
  claims: {
    all: ['claims'] as const,
    list: (p: ClaimsApiParams & { location: Loc }) => ['claims', 'list', p] as const,
  },
  claim: (id: string) => ['claim', id] as const,
  claimAll: ['claim'] as const,
  views: ['views'] as const,
  run: (id: string) => ['run', id] as const,
  activity: (p: ActivityParams = {}) => ['activity', p] as const,
  activityAll: ['activity'] as const,
  /** Root of every preview; mutations that change this week's decisions invalidate it. */
  preview: ['preview'] as const,
  previewOf: (p: PreviewParams) => ['preview', p] as const,
  ledger: ['ledger'] as const,
  eligibility: (p: { date?: string | undefined }) => ['eligibility', 'list', p] as const,
  benefits: (appointmentId: string) => ['eligibility', 'benefits', appointmentId] as const,
  cash: (location: Loc) => ['cash', { location }] as const,
  denials: ['denials'] as const,
  /** ['rules'] is the table; changes hang under it so one invalidation reaches both. */
  rules: ['rules'] as const,
  ruleChanges: ['rules', 'changes'] as const,
  proposals: ['proposals'] as const,
}
