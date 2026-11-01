/**
 * One typed function per endpoint in docs/spec/02-api.md that the web app calls. Hooks in src/hooks/
 * wrap these in TanStack Query; nothing else calls `http` directly.
 */
import { z } from 'zod'
import type { ClaimsApiParams } from '@/features/claims/search'
import { session } from '@/state/session'
import { http } from './client'
import * as S from './schema'

export interface PreviewParams {
  rule_id: string
  mode?: S.RuleMode | undefined
  max_cents?: number | undefined
}
export interface ActivityParams {
  day?: string | undefined
  agent?: S.AgentKind | undefined
  outcome?: S.ActivityOutcome | undefined
}

const loc = () => ({ location_id: session.locationParam() })
const Ok = z.object({ meta: S.MutationMeta.nullish() }).passthrough()
const enc = encodeURIComponent

export const api = {
  // clock & agents runtime
  clock: () => http.get('/clock', S.Clock),
  advanceClock: (body: { to: string } | { minutes: number }) => http.post('/clock/advance', S.ClockAdvanceAccepted, body),
  advanceStatus: (id: string) => http.get(`/clock/advance/${enc(id)}`, S.AdvanceSnapshot),
  resetClock: () => http.post('/clock/reset', Ok),
  agentsStatus: () => http.get('/agents/status', S.AgentsStatus),
  pauseAgents: () => http.post('/agents:pause', Ok),
  resumeAgents: () => http.post('/agents:resume', Ok),
  worldStatus: () => http.get('/_world/status', S.WorldStatus),

  // summary
  strip: () => http.get('/summary/strip', S.StripSummary, loc()),

  // inbox
  inbox: (p: { state: string; kind?: string | undefined; agent?: string | undefined }, signal?: AbortSignal) =>
    http.get('/inbox', S.InboxList, { ...p, group: true, ...loc() }, signal),
  inboxItem: (id: string) => http.get(`/inbox/${enc(id)}`, S.InboxItemDetail),
  approve: (id: string, edits?: Record<string, unknown>) =>
    http.post(`/inbox/${enc(id)}:approve`, S.ApproveResponse, edits ? { edits } : {}, { idempotencyKey: `approve:${id}` }),
  approveGroup: (groupKey: string) =>
    http.post('/inbox:approve-group', S.ApproveGroupResponse, { group_key: groupKey }, { idempotencyKey: `approve-group:${groupKey}` }),
  reject: (id: string, reason: string) => http.post(`/inbox/${enc(id)}:reject`, S.ItemResponse, { reason }),
  snooze: (id: string, until: string) => http.post(`/inbox/${enc(id)}:snooze`, S.ItemResponse, { until }),
  reopen: (id: string) => http.post(`/inbox/${enc(id)}:reopen`, S.ItemResponse),
  alwaysAutoRun: (id: string) => http.post(`/inbox/${enc(id)}:always-auto-run`, S.ProposalResponse),

  // claims
  claims: (p: ClaimsApiParams, cursor: string | undefined, signal?: AbortSignal) =>
    http.get('/claims', S.ClaimList, { ...p, cursor, limit: 200, ...loc() }, signal),
  claim: (id: string) => http.get(`/claims/${enc(id)}`, S.ClaimDetail),
  correctedClaim: (id: string, changes: Record<string, unknown>) =>
    http.post(`/claims/${enc(id)}:corrected`, S.CorrectedClaimResponse, { changes }),
  triage: (id: string, agent?: 'claims' | 'followup') =>
    http.post(`/claims/${enc(id)}:triage`, S.TriageAccepted, agent ? { agent } : {}),
  views: () => http.get('/views', S.listOf(S.SavedView)),
  saveView: (name: string, search_params: Record<string, unknown>) =>
    http.post('/views', S.SavedView, { name, search_params }),

  // runs
  run: (id: string) => http.get(`/runs/${enc(id)}`, S.Run),

  // Settings › Agents
  rules: () => http.get('/rules', S.RulesOut),
  ruleChanges: () => http.get('/rules/changes', S.RuleChangeList),
  patchRule: (id: string, patch: S.RulePatch) => http.patch(`/rules/${enc(id)}`, S.RulePatchResponse, patch),
  preview: (p: PreviewParams, signal?: AbortSignal) => http.get('/settings/preview', S.Preview, { ...p }, signal),
  setPracticeCap: (cents: number) => http.patch('/settings/practice', S.PracticeSettings, { practice_cap_cents: cents }),
  proposals: () => http.get('/proposals', S.ProposalList),
  acceptProposal: (id: string) => http.post(`/proposals/${enc(id)}:accept`, S.ProposalResponse, undefined, { idempotencyKey: `accept:${id}` }),
  dismissProposal: (id: string) => http.post(`/proposals/${enc(id)}:dismiss`, S.ProposalResponse, undefined, { idempotencyKey: `dismiss:${id}` }),

  // static screens (the API scopes /cash by location; the others are practice-wide)
  activity: (p: ActivityParams) => http.get('/activity', S.ActivityOut, { ...p }),
  ledger: () => http.get('/ledger/today', S.Ledger),
  eligibility: (p: { date?: string | undefined }) => http.get('/eligibility', S.EligibilityOut, { ...p }),
  benefits: (appointmentId: string) => http.get(`/eligibility/${enc(appointmentId)}`, S.BenefitsPanel),
  cash: () => http.get('/cash', S.CashSummary, loc()),
  denials: () => http.get('/denials', S.DenialsOut),
}

export const sseUrl = {
  runEvents: (id: string) => `/runs/${enc(id)}/events`,
  firehose: '/runs/stream',
}
