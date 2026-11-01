/**
 * One typed function per endpoint in docs/spec/02-api.md that the web app calls. Hooks in src/hooks/
 * wrap these in TanStack Query; nothing else calls `http` directly.
 */
import { z } from 'zod'
import type { ClaimsApiParams } from '@/features/claims/search'
import { session } from '@/state/session'
import { http } from './client'
import * as S from './schema'

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

  // static screens
  activity: (p: Record<string, string | undefined>) => http.get('/activity', S.listOf(S.ActivityRow), { ...p, ...loc() }),
  ledger: () => http.get('/ledger/today', S.Ledger, loc()),
  eligibility: (p: { date?: string | undefined }) => http.get('/eligibility', S.listOf(S.EligibilityRow), { ...p, ...loc() }),
  cash: () => http.get('/cash', S.CashSummary, loc()),
  denials: () => http.get('/denials', z.object({ groups: z.array(S.DenialGroup) })),
  rules: () => http.get('/rules', S.listOf(S.Rule)),
  ruleChanges: () => http.get('/rules/changes', S.listOf(S.RuleChange)),
  proposals: () => http.get('/proposals', S.listOf(S.RuleProposal)),
}

export const sseUrl = {
  runEvents: (id: string) => `/runs/${enc(id)}/events`,
  firehose: '/runs/stream',
}
