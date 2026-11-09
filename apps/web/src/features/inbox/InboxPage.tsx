/**
 * Inbox (home), D1: the queue on the left, one pane on the right that is either the decision or, after Approve,
 * the run (ADR-0008 decision 4: the run owns the pane). State ownership on this screen:
 *  - URL (`/inbox?item=&group=&launch=&kind=`): selection, expanded group, the run in the pane, filter tab. Selecting
 *    an item (J/K, click, Next) drops `launch`: the run carries on and stays under "Runs you started".
 *  - Approve / ⇧A set `launch=starting` in the same handler as `mutate()`: the pane is the run at once, "Starting…"
 *    drawn from the pending mutation's variables, and the same panel takes the launch when the 202 records it. A
 *    refusal (409, 403, network) returns the URL to the item and says the server's reason there. The callbacks read
 *    the URL as it is when the server answers: if the reader has moved on, a 202 only lists the run and a refusal
 *    is a toast with a way back.
 *  - Query cache: the list (['inbox','list',params]), item detail, runs, strip, claims. Counts are the server's.
 *  - `useActiveLaunch`: which claims are under a run, from the server's run status and `claim.move`. Approve, Reject
 *    and Snooze are locked only for items on those claims.
 *  - Component state: which inline form is open, a 409 file_departed notice and a refusal's reason: ephemeral, per item.
 */
import { useState } from 'react'
import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import type { InboxGroup, InboxItem } from '@/api/schema'
import { useActiveLaunch } from '@/hooks/useActiveLaunch'
import { useInboxList } from '@/hooks/useInbox'
import { useApprove, useApproveGroup, useCorrectedClaim, useReject, useSnooze, type FileDeparted, type Refusal } from '@/hooks/useInboxActions'
import { useListKeys } from '@/hooks/useListKeys'
import { useNow } from '@/hooks/useClock'
import { useStrip } from '@/hooks/useStrip'
import { count, plural } from '@/lib/format'
import { navBadge } from '@/lib/strip'
import { cn } from '@/lib/cn'
import { useLaunches, type Launch } from '@/state/launches'
import { toast } from '@/state/toast'
import { PageHeader } from '@/components/PageHeader'
import { ProgressPanel, type StartingRow } from '@/components/ProgressPanel'
import { EmptyState } from '@/components/EmptyState'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { InboxDecision, type DetailPanel } from './InboxDecision'
import { InboxQueue } from './InboxQueue'
import { STARTING, type InboxSearch } from './search'
import { approveStartsRun, groupFor, groupRowId, inboxGroups, itemOrder, keyOrder, nextSelection, waitingLine } from './selectors'

const route = getRouteApi('/inbox')

const who = (i: InboxItem) => [i.patient?.display_name ?? i.claim?.patient.display_name ?? i.title, i.claim ? `#${i.claim.number}` : null].filter(Boolean).join(' ')
/** A run's relay label, as `recordLaunch` writes it from the server's item. */
const runRow = (i: InboxItem): StartingRow => ({
  label: [i.claim ? `#${i.claim.number}` : null, i.patient?.display_name].filter(Boolean).join(' ') || i.title,
  claim_id: i.claim?.id ?? null,
})
const itemHref = (i: InboxItem) => `/inbox?${new URLSearchParams({ item: i.id, ...(i.group_key ? { group: i.group_key } : {}) }).toString()}`

/** The approval this tab sent last, single or batch, as the run pane needs it before and after the server answers. */
interface Attempt {
  key: string
  pending: boolean
  ok: boolean
  itemIds: string[]
  /** The run the 202 named (a batch's first): the launch's id. */
  runId: string | undefined
  /** Stands in for the launch until it exists: the same heading and "What this does". */
  standIn: Launch
  rows: StartingRow[]
}

export function InboxPage() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/inbox' })
  const list = useInboxList(search)
  const strip = useStrip()
  const now = useNow()
  const launches = useLaunches()
  const active = useActiveLaunch()
  const router = useRouter()

  // Ephemeral, per selected item.
  const [panelFor, setPanelFor] = useState<{ id: string; panel: DetailPanel } | null>(null)
  const [departed, setDeparted] = useState<FileDeparted | null>(null)
  const [refused, setRefused] = useState<{ itemId: string; message: string } | null>(null)

  const select = (patch: { item?: string | undefined; group?: string | undefined; launch?: string | undefined }) =>
    navigate({ search: (s) => ({ ...s, launch: undefined, ...patch }), replace: true })

  /** Whether the pane still shows the approval in flight, read when the server answers (the reader may have moved on). */
  const stillStarting = () => {
    const loc = router.state.location
    return loc.pathname === '/inbox' && (loc.search as InboxSearch).launch === STARTING
  }
  // The 202: the pane already shows this approval, so it takes the run. Moved on, the run is only listed.
  const openLaunch = (l: Launch) => {
    if (stillStarting()) void navigate({ search: (s) => ({ ...s, launch: l.id }), replace: true })
  }
  const onRefused = (back: InboxItem | undefined, r: Refusal) => {
    if (!back) toast(r.message, { tone: r.tone })
    else if (stillStarting()) {
      void navigate({ search: (s) => ({ ...s, item: back.id, group: back.group_key ?? undefined, launch: undefined }), replace: true })
      if (!r.departed) setRefused({ itemId: back.id, message: r.message })
    } else {
      toast(r.message, { tone: r.tone, action: { label: `Back to ${who(back)}`, href: itemHref(back) } })
    }
  }
  const approve = useApprove({ onLaunched: openLaunch, onFileDeparted: setDeparted, onRefused: (r, v) => onRefused(v.item, r) })
  const approveGroup = useApproveGroup({ onLaunched: openLaunch, onRefused: (r, v) => onRefused(v.from ?? v.items[0], r) })
  const reject = useReject()
  const snooze = useSnooze()
  const corrected = useCorrectedClaim()

  const data = list.data
  const items = data?.items ?? []
  const selected: InboxItem | undefined = items.find((i) => i.id === search.item)
  const group = groupFor(data, selected)
  const members = group ? items.filter((i) => group.group.item_ids.includes(i.id)) : []
  const order = data ? itemOrder(data) : []
  const keys = data ? keyOrder(data, search.group) : []
  const panel = panelFor?.id === selected?.id ? (panelFor?.panel ?? 'none') : 'none'
  const setPanel = (p: DetailPanel) => {
    setPanelFor(selected ? { id: selected.id, panel: p } : null)
  }
  const sending = approve.isPending || approveGroup.isPending
  const busy = sending || reject.isPending || snooze.isPending
  const launch = launches.find((l) => l.id === search.launch)
  const attempt = latestAttempt(approve, approveGroup)
  const attemptLaunch = attempt?.runId ? launches.find((l) => l.id === attempt.runId) : undefined
  // The run pane for the approval in flight: from the click (before the URL commits, the approved item still names
  // it) until the URL catches up with the server's answer. Once the 202 has recorded the launch, the same panel
  // (same key) shows it, so focus and the live region carry over.
  const ownsPane =
    attempt !== null &&
    (search.launch === STARTING || (attempt.pending && search.launch === undefined && search.item !== undefined && attempt.itemIds.includes(search.item)))
  const runPane = ownsPane
    ? attemptLaunch
      ? { key: attempt.key, launch: attemptLaunch, starting: undefined }
      : attempt.ok
        ? null // no run after all (the API answered without one): the item pane shows
        : { key: attempt.key, launch: attempt.standIn, starting: attempt.rows }
    : launch
      ? { key: launch.id === attempt?.runId ? attempt.key : launch.id, launch, starting: undefined }
      : null
  const lock = active.lockFor(selected?.claim)
  const groupLock = members.map((m) => active.lockFor(m.claim)).find((l) => l !== null) ?? null

  const removeAndAdvance = (ids: string[], patch: { group?: undefined; launch?: typeof STARTING } = {}) => {
    void select({ item: nextSelection(order, ids, search.item), ...patch })
    setPanelFor(null)
  }

  /** A locked key press says why instead of doing nothing. */
  const guarded = (l: { reason: string } | null, fn: () => void) => () => {
    if (l) toast(`${l.reason}. This opens when the run ends.`, { tone: 'info' })
    else fn()
  }

  // `mutate` first: any render after it reads the pending mutation (useSyncExternalStore), so the frame that commits
  // `launch=starting` already draws "Starting…", never the next item.
  const doApprove = (item: InboxItem, edits?: Record<string, unknown>) => {
    setRefused(null)
    approve.mutate({ item, ...(edits ? { edits } : {}) })
    removeAndAdvance([item.id], approveStartsRun(item) ? { launch: STARTING } : {})
  }
  const doApproveGroup = (g: InboxGroup, gm: InboxItem[]) => {
    setRefused(null)
    approveGroup.mutate({ groupKey: g.group_key, title: g.title, items: gm, wording: { action_label: g.action_label, touches: g.touches }, ...(selected ? { from: selected } : {}) })
    removeAndAdvance(gm.map((m) => m.id), { group: undefined, launch: STARTING })
  }
  /** A or ⇧A while an approval is on its way: say so, instead of a key that does nothing. */
  const waitForIt = () => {
    toast(`${attempt?.rows.map((r) => r.label).join(', ') || 'Your approval'} is starting. Approve opens when the server answers.`, { tone: 'info' })
  }
  const openGroup = (g: InboxGroup) => void select({ group: g.group_key, item: g.item_ids[0] })

  const selectKey = (id: string) => {
    if (id.startsWith('group:')) {
      const g = data && inboxGroups(data).find((x) => groupRowId(x.group_key) === id)
      if (g) openGroup(g)
      return
    }
    const it = items.find((i) => i.id === id)
    void select({ item: id, group: it?.group_key ?? search.group })
  }

  const blocked = selected?.signer_note != null
  const openClaim = (it: InboxItem | undefined) => {
    if (it?.claim) void navigate({ to: '/claims/$claimId', params: { claimId: it.claim.id }, search: { from: `inbox:${it.id}` } })
  }

  useListKeys({
    ids: keys,
    selectedId: search.item,
    onSelect: selectKey,
    onOpen: (id) => openClaim(items.find((i) => i.id === id)),
    bindings: {
      a: selected && !blocked && departed?.itemId !== selected.id ? (sending ? waitForIt : busy ? undefined : guarded(lock, () => doApprove(selected))) : undefined,
      e: selected && !blocked ? guarded(lock, () => setPanel('edit')) : undefined,
      r: selected && !blocked ? guarded(lock, () => setPanel('reject')) : undefined,
      s: selected && !blocked ? guarded(lock, () => setPanel('snooze')) : undefined,
      'shift+a': group ? (sending ? waitForIt : busy ? undefined : guarded(groupLock, () => doApproveGroup(group.group, members))) : undefined,
      'g c': selected?.claim ? () => openClaim(selected) : undefined,
      escape: search.launch ? () => void select({ item: search.item }) : undefined,
    },
  })

  const inboxOpen = navBadge(strip.data, 'inbox')
  const ranAlone = navBadge(strip.data, 'activity')
  const s = strip.data

  const queueBody = list.isPending ? (
    <SkeletonRows rows={10} />
  ) : list.isError ? (
    <QueryError error={list.error} what="the Inbox" onRetry={() => void list.refetch()} />
  ) : !data || items.length === 0 ? (
    <EmptyState title="Nothing needs you" action={<Link to="/activity" className="font-medium text-act">See Activity →</Link>}>
      {ranAlone !== null ? `Agents handled ${count(ranAlone)} items this week without you.` : 'Agents are handling the rest.'}
    </EmptyState>
  ) : null

  const next = selected ?? items.find((i) => i.signer_note === null)
  const pane = runPane ? (
    <ProgressPanel
      key={runPane.key}
      launch={runPane.launch}
      {...(runPane.starting ? { starting: runPane.starting } : {})}
      variant="pane"
      onClose={() => void select({ item: search.item })}
      footer={({ failed }) => {
        const back = failed.map((r) => items.find((i) => i.run_id === r.id)).find((i): i is InboxItem => Boolean(i))
        return (
          <>
            {back && (
              <Button variant="primary" size="lg" onClick={() => void select({ item: back.id, group: back.group_key ?? undefined })}>
                Back to {who(back)}
              </Button>
            )}
            {next && next.id !== back?.id ? (
              <Button variant={back ? 'default' : 'primary'} size="lg" onClick={() => void select({ item: next.id, group: next.group_key ?? undefined })}>
                Next: {who(next)}
              </Button>
            ) : (
              !back && (
                <Button variant="primary" size="lg" onClick={() => void select({ item: undefined })}>
                  Finish
                </Button>
              )
            )}
          </>
        )
      }}
    />
  ) : search.launch && search.launch !== STARTING ? (
    <EmptyState title="This run was started in another tab">Runs you start are listed in the tab that started them. Its claim shows the result.</EmptyState>
  ) : selected ? (
    <InboxDecision
      key={selected.id}
      item={selected}
      group={group ? { group: group.group, members } : null}
      panel={panel}
      setPanel={setPanel}
      now={now}
      departed={departed?.itemId === selected.id ? departed : null}
      refused={refused?.itemId === selected.id ? refused.message : null}
      busy={busy}
      lock={group ? groupLock : lock}
      onApprove={(edits) => doApprove(selected, edits)}
      onApproveGroup={() => {
        if (group) doApproveGroup(group.group, members)
      }}
      onReject={(reason) => {
        removeAndAdvance([selected.id])
        reject.mutate({ item: selected, reason })
      }}
      onSnooze={(until, label) => {
        removeAndAdvance([selected.id])
        snooze.mutate({ item: selected, until, label })
      }}
      onCorrected={() => {
        if (selected.claim) corrected.mutate({ claimId: selected.claim.id, changes: selected.proposed_action?.params ?? {} })
        setDeparted(null)
      }}
    />
  ) : items.length > 0 ? (
    <section className="px-6 pb-6 pt-14" data-testid="inbox-empty-pane">
      <h1 className="m-0 text-title font-semibold">{next ? 'Pick up where you left off' : 'Nothing is waiting on you'}</h1>
      <p className="m-0 mt-1.5 text-mid">{next ? `${who(next)} is next. ${next.title}.` : 'Every item left is one someone else signs.'}</p>
      {next && (
        <Button variant="primary" size="lg" className="mt-4" onClick={() => void select({ item: next.id, group: next.group_key ?? undefined })}>
          Open {who(next)}
        </Button>
      )}
    </section>
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Inbox"
        sub={
          inboxOpen !== null && s
            ? [`${plural(inboxOpen, 'item')} need you: ${plural(s.inbox_claims, 'claim')}, ${plural(s.inbox_visits, 'upcoming visit')}`, waitingLine(s.inbox_waiting)].filter(Boolean).join(' · ')
            : undefined
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[516px_minmax(0,1fr)] gap-3 px-4 pb-4 pt-3">
        <InboxQueue
          list={data}
          body={queueBody}
          kind={search.kind}
          selectedId={search.launch ? undefined : search.item}
          expandedGroup={search.group}
          keyCursor={search.item}
          activeLaunch={search.launch}
          onSelect={(id) => void select({ item: id, group: items.find((i) => i.id === id)?.group_key ?? undefined })}
          onOpenGroup={openGroup}
          onOpenLaunch={(id) => void select({ item: search.item, launch: id })}
        />
        <div className={cn('panel min-h-0 overflow-y-auto', list.isPlaceholderData && 'opacity-70')}>{pane}</div>
      </div>
    </div>
  )
}

/** The latest Approve or ⇧A this page sent, or null before the first. */
function latestAttempt(single: ReturnType<typeof useApprove>, batch: ReturnType<typeof useApproveGroup>): Attempt | null {
  const one = single.variables && !single.isIdle ? single : null
  const many = batch.variables && !batch.isIdle ? batch : null
  if (one?.variables && (!many || one.submittedAt >= many.submittedAt)) {
    const item = one.variables.item
    return {
      key: `approve:${one.submittedAt}`,
      pending: one.isPending,
      ok: one.isSuccess,
      itemIds: [item.id],
      runId: one.data?.run?.id,
      standIn: { id: STARTING, kind: 'approve', title: item.title, runs: [], started_at: '', action_label: item.action_label, touches: item.touches },
      rows: [runRow(item)],
    }
  }
  if (!many?.variables) return null
  const v = many.variables
  return {
    key: `approve_group:${many.submittedAt}`,
    pending: many.isPending,
    ok: many.isSuccess,
    itemIds: v.items.map((i) => i.id),
    runId: many.data?.runs[0]?.id,
    standIn: { id: STARTING, kind: 'approve_group', title: `Approve ${v.items.length} · ${v.title}`, runs: [], started_at: '', action_label: v.wording?.action_label ?? null, touches: v.wording?.touches ?? [] },
    rows: v.items.map(runRow),
  }
}
