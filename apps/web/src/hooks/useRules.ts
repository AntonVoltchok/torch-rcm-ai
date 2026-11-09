/**
 * Settings › Agents: reads (rules table, change log, proposals, live preview) and mutations
 * (docs/spec/05-frontend.md "Mutations").
 *
 * PATCH rule is optimistic on the mode only: the row flips at once, rolls back on any error. A tier-2 change by
 * anyone but the owner comes back `409 owner_signoff_required` — the server has created Dr. Morgan's sign-off
 * item instead — so the row reverts, a toast says where it went, and the strip/inbox are refetched so her badge
 * moves from server counts (the error envelope carries no `meta.counts`). Counts are never bumped on the client.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, type PreviewParams } from '@/api/endpoints'
import { isApiError } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { RulePatch, RulesOut } from '@/api/schema'
import { toast } from '@/state/toast'
import { changeDiff, withRule, withRuleMode } from '@/features/settings/selectors'

export function useRules() {
  return useQuery({ queryKey: qk.rules, queryFn: api.rules })
}
export function useRuleChanges() {
  return useQuery({ queryKey: qk.ruleChanges, queryFn: api.ruleChanges })
}
export function useProposals() {
  return useQuery({ queryKey: qk.proposals, queryFn: api.proposals })
}

/** GET /settings/preview for whatever the user is hovering or editing; `null` = nothing to preview. */
export function usePreview(p: PreviewParams | null) {
  const params: PreviewParams = { rule_id: p?.rule_id ?? '', mode: p?.mode, max_cents: p?.max_cents }
  return useQuery({
    queryKey: qk.previewOf(params),
    queryFn: ({ signal }) => api.preview(params, signal),
    enabled: Boolean(p?.rule_id),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/** After anything that changes the rule set, every cached rule-derived read is stale. */
function settleRules(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.rules }) // table + changes
  void qc.invalidateQueries({ queryKey: qk.preview })
  void qc.invalidateQueries({ queryKey: qk.proposals })
}

export function usePatchRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ruleId: string; label: string; patch: RulePatch }) => api.patchRule(v.ruleId, v.patch),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.rules, exact: true })
      const snapshot = qc.getQueryData<RulesOut>(qk.rules)
      if (snapshot && v.patch.mode) qc.setQueryData<RulesOut>(qk.rules, withRuleMode(snapshot, v.ruleId, v.patch.mode))
      return { snapshot }
    },
    onSuccess: (res, v) => {
      qc.setQueryData<RulesOut>(qk.rules, (old) => (old ? withRule(old, res.rule) : old))
      toast(`${v.label}: ${changeDiff(res.change).join(', ') || 'saved'}.`, { tone: 'ok' })
    },
    onError: (err, v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.rules, ctx.snapshot)
      if (isApiError(err, 'owner_signoff_required')) {
        toast('Sent to Dr. Morgan for sign-off', { tone: 'info', action: { label: 'Open Inbox', href: '/inbox' } })
        void qc.invalidateQueries({ queryKey: qk.stripAll })
        void qc.invalidateQueries({ queryKey: qk.inbox.all })
        return
      }
      if (isApiError(err, 'human_only')) toast(`${v.label} is human only: there is no setting to change.`, { tone: 'warn' })
      else toast(isApiError(err) ? err.message : `Could not change ${v.label}.`, { tone: 'bad' })
    },
    onSettled: () => {
      settleRules(qc)
    },
  })
}

/** assumed endpoint PATCH /settings/practice (see docs/plans/web-s2.md §2). */
export function useSetPracticeCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cents: number) => api.setPracticeCap(cents),
    onSuccess: () => {
      toast('Practice cap saved.', { tone: 'ok' })
    },
    onError: (err) => {
      toast(isApiError(err) ? err.message : 'Could not save the practice cap.', { tone: 'bad' })
    },
    onSettled: () => {
      settleRules(qc)
    },
  })
}

export function useAcceptProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.acceptProposal(id),
    onSuccess: (res) => {
      const label = res.rule?.label ?? res.proposal.title
      toast(`New rule: ${label}.`, { tone: 'ok', ...(res.rule ? { action: { label: 'See it', href: `/settings/agents?tab=rules&rule=${res.rule.id}` } } : {}) })
    },
    onError: (err) => {
      toast(isApiError(err) ? err.message : 'Could not accept the proposal.', { tone: isApiError(err, 'root_cause_guard') ? 'warn' : 'bad' })
    },
    onSettled: () => {
      settleRules(qc)
    },
  })
}

export function useDismissProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.dismissProposal(id),
    onSuccess: () => {
      toast('Proposal dismissed. It will not be proposed again from the same evidence.', { tone: 'info' })
    },
    onError: (err) => {
      toast(isApiError(err) ? err.message : 'Could not dismiss the proposal.', { tone: 'bad' })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.proposals })
    },
  })
}
