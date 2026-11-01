/**
 * Inbox mutations (docs/spec/05-frontend.md "Mutations").
 *
 * approve / approveGroup: optimistic removal from every cached ['inbox','list',…] (snapshot first),
 * rollback on error; on 202 the run snapshots are seeded into ['run', id] and a Launch is recorded so
 * the ProgressPanel can subscribe; onSettled invalidates inbox, claim(s), claims, activity, preview.
 * ['strip'] is never touched here: the API client writes it from `meta.counts`.
 * The run itself is not optimistic — its steps stream in.
 */
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { isApiError } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { InboxItem, InboxList, Run } from '@/api/schema'
import { launchStore, type Launch } from '@/state/launches'
import { toast } from '@/state/toast'
import { withoutItems } from '@/features/inbox/selectors'

type Snapshot = [QueryKey, InboxList | undefined][]

async function removeOptimistically(qc: QueryClient, ids: readonly string[]): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: qk.inbox.lists() })
  const snapshot = qc.getQueriesData<InboxList>({ queryKey: qk.inbox.lists() })
  qc.setQueriesData<InboxList>({ queryKey: qk.inbox.lists() }, (old) => (old ? withoutItems(old, ids) : old))
  return snapshot
}

function rollback(qc: QueryClient, snapshot: Snapshot | undefined) {
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data))
}

function settle(qc: QueryClient, claimIds: (string | null | undefined)[]) {
  void qc.invalidateQueries({ queryKey: qk.inbox.all })
  void qc.invalidateQueries({ queryKey: qk.claims.all })
  void qc.invalidateQueries({ queryKey: qk.activityAll })
  void qc.invalidateQueries({ queryKey: qk.preview })
  void qc.invalidateQueries({ queryKey: qk.agents })
  for (const id of claimIds) if (id) void qc.invalidateQueries({ queryKey: qk.claim(id) })
}

function recordLaunch(qc: QueryClient, kind: Launch['kind'], title: string, runs: Run[], items: InboxItem[]): Launch {
  for (const run of runs) qc.setQueryData(qk.run(run.id), run)
  const launch: Launch = {
    id: runs[0]?.id ?? `launch_${items[0]?.id ?? 'x'}`,
    kind,
    title,
    runs: runs.map((r) => {
      const item = items.find((i) => i.id === r.inbox_item_id)
      const n = item?.subject?.claim_number
      return {
        run_id: r.id,
        claim_id: r.claim_id ?? null,
        item_id: item?.id ?? r.inbox_item_id ?? null,
        label: [n ? `#${n}` : null, item?.subject?.patient_name].filter(Boolean).join(' ') || (item?.title ?? r.id),
      }
    }),
    started_at: qc.getQueryData<{ now: string }>(qk.clock)?.now ?? runs[0]?.started_at ?? '',
  }
  launchStore.add(launch)
  return launch
}

export interface FileDeparted {
  itemId: string
  message: string
}

function explain(err: unknown): string {
  if (isApiError(err, 'already_resolved')) return `Already handled: ${err.message}`
  if (isApiError(err, 'tier_requires_owner')) return err.message
  if (isApiError(err, 'network')) return 'The API is unreachable; nothing was sent.'
  return 'Approval failed; nothing was sent. The item is back in your Inbox.'
}

export function useApprove(opts: { onLaunched?: (l: Launch) => void; onFileDeparted?: (d: FileDeparted) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { item: InboxItem; edits?: Record<string, unknown> }) => api.approve(v.item.id, v.edits),
    onMutate: async (v) => ({ snapshot: await removeOptimistically(qc, [v.item.id]) }),
    onSuccess: (res, v) => {
      opts.onLaunched?.(recordLaunch(qc, 'approve', v.item.title, [res.run], [res.item]))
    },
    onError: (err, v, ctx) => {
      rollback(qc, ctx?.snapshot)
      if (isApiError(err, 'file_departed')) {
        toast(err.message, { tone: 'warn' })
        opts.onFileDeparted?.({ itemId: v.item.id, message: err.message })
        return
      }
      toast(explain(err), { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => {
      settle(qc, [v.item.claim_id])
    },
  })
}

export function useApproveGroup(opts: { onLaunched?: (l: Launch) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { groupKey: string; title: string; items: InboxItem[] }) => api.approveGroup(v.groupKey),
    onMutate: async (v) => ({ snapshot: await removeOptimistically(qc, v.items.map((i) => i.id)) }),
    onSuccess: (res, v) => {
      opts.onLaunched?.(recordLaunch(qc, 'approve_group', `Approve ${res.items.length} · ${v.title}`, res.runs, res.items))
    },
    onError: (err, _v, ctx) => {
      rollback(qc, ctx?.snapshot)
      toast(explain(err), { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => {
      settle(qc, v.items.map((i) => i.claim_id))
    },
  })
}

export function useReject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { item: InboxItem; reason: string }) => api.reject(v.item.id, v.reason),
    onMutate: async (v) => ({ snapshot: await removeOptimistically(qc, [v.item.id]) }),
    onSuccess: () => {
      toast('Rejected. The agent will not retry this proposal.', { tone: 'info' })
    },
    onError: (err, _v, ctx) => {
      rollback(qc, ctx?.snapshot)
      toast(isApiError(err) ? err.message : 'Reject failed.', { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => {
      settle(qc, [v.item.claim_id])
    },
  })
}

export function useSnooze() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { item: InboxItem; until: string; label: string }) => api.snooze(v.item.id, v.until),
    onMutate: async (v) => ({ snapshot: await removeOptimistically(qc, [v.item.id]) }),
    onSuccess: (_d, v) => {
      toast(`Snoozed until ${v.label}.`, { tone: 'info' })
    },
    onError: (err, _v, ctx) => {
      rollback(qc, ctx?.snapshot)
      toast(isApiError(err) ? err.message : 'Snooze failed.', { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => {
      settle(qc, [v.item.claim_id])
    },
  })
}

/** "Always auto-run" creates a RuleProposal; `422 root_cause_guard` comes back as an inline reason. */
export function useAlwaysAutoRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: InboxItem) => api.alwaysAutoRun(item.id),
    onSuccess: () => {
      toast('Proposal created for Dr. Morgan.', { tone: 'ok', action: { label: 'See proposals', href: '/settings/agents?tab=proposals' } })
      void qc.invalidateQueries({ queryKey: qk.proposals })
    },
  })
}

/** After 409 file_departed: the edits go as a corrected claim (tier 2), reviewed before it is sent. */
export function useCorrectedClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { claimId: string; changes: Record<string, unknown> }) => api.correctedClaim(v.claimId, v.changes),
    onSuccess: () => {
      toast('Corrected claim (freq. 7) built — it is in your Inbox for review (tier 2).', { tone: 'ok' })
    },
    onError: (err) => {
      toast(isApiError(err) ? err.message : 'Could not build the corrected claim.', { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => {
      settle(qc, [v.claimId])
    },
  })
}

