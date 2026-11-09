/**
 * Inbox (home). State ownership on this screen:
 *  - URL (`/inbox?item=&group=&launch=&kind=`): selection, expanded group, open run panel, filter tab.
 *  - Query cache: the list (['inbox','list',params]), item detail, runs, strip. Counts are the server's.
 *  - Component state: which inline form is open and a 409 file_departed notice — ephemeral, per item.
 */
import { useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { InboxGroup, InboxItem, InboxItemKind } from '@/api/schema'
import { useInboxList } from '@/hooks/useInbox'
import { useApprove, useApproveGroup, useCorrectedClaim, useReject, useSnooze, type FileDeparted } from '@/hooks/useInboxActions'
import { useListKeys } from '@/hooks/useListKeys'
import { useNow } from '@/hooks/useClock'
import { useStrip } from '@/hooks/useStrip'
import { count, plural } from '@/lib/format'
import { navBadge } from '@/lib/strip'
import { cn } from '@/lib/cn'
import { useLaunches, type Launch } from '@/state/launches'
import { PageHeader } from '@/components/PageHeader'
import { ProgressPanel } from '@/components/ProgressPanel'
import { EmptyState } from '@/components/EmptyState'
import { QueryError } from '@/components/QueryError'
import { KeyboardHints } from '@/components/KeyboardHints'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { InboxDetail, type DetailPanel } from './InboxDetail'
import { InboxListView } from './InboxList'
import { RecentRuns } from './RecentRuns'
import { groupFor, groupRowId, inboxGroups, inboxMix, itemOrder, keyOrder, nextSelection } from './selectors'

const route = getRouteApi('/inbox')

const TABS: { kind: InboxItemKind | undefined; label: string }[] = [
  { kind: undefined, label: 'All' },
  { kind: 'approve_action', label: 'Approvals' },
  { kind: 'review_draft', label: 'Drafts' },
  { kind: 'variance', label: 'Variances' },
  { kind: 'eligibility_flag', label: 'Eligibility' },
]

export function InboxPage() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/inbox' })
  const list = useInboxList(search)
  const strip = useStrip()
  const now = useNow()
  const launches = useLaunches()

  // Ephemeral, per selected item.
  const [panelFor, setPanelFor] = useState<{ id: string; panel: DetailPanel } | null>(null)
  const [departed, setDeparted] = useState<FileDeparted | null>(null)

  const select = (patch: { item?: string | undefined; group?: string | undefined; launch?: string | undefined }) =>
    navigate({ search: (s) => ({ ...s, ...patch }), replace: true })

  const openLaunch = (l: Launch) => void select({ launch: l.id })
  const approve = useApprove({ onLaunched: openLaunch, onFileDeparted: setDeparted })
  const approveGroup = useApproveGroup({ onLaunched: openLaunch })
  const reject = useReject()
  const snooze = useSnooze()
  const corrected = useCorrectedClaim()

  const data = list.data
  const items = data?.items ?? []
  const selected: InboxItem | undefined = items.find((i) => i.id === search.item)
  const group = groupFor(data, selected)
  const order = data ? itemOrder(data) : []
  const keys = data ? keyOrder(data, search.group) : []
  const panel = panelFor?.id === selected?.id ? (panelFor?.panel ?? 'none') : 'none'
  const setPanel = (p: DetailPanel) => {
    setPanelFor(selected ? { id: selected.id, panel: p } : null)
  }
  const busy = approve.isPending || approveGroup.isPending || reject.isPending || snooze.isPending
  const launch = launches.find((l) => l.id === search.launch)

  const removeAndAdvance = (ids: string[], patch: { group?: undefined } = {}) => {
    void select({ item: nextSelection(order, ids, search.item), ...patch })
    setPanelFor(null)
  }

  const doApprove = (item: InboxItem, edits?: Record<string, unknown>) => {
    removeAndAdvance([item.id])
    approve.mutate({ item, ...(edits ? { edits } : {}) })
  }
  const doApproveGroup = (g: InboxGroup, members: InboxItem[]) => {
    removeAndAdvance(members.map((m) => m.id), { group: undefined })
    approveGroup.mutate({ groupKey: g.group_key, title: g.title, items: members })
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

  const currentGroup = group ?? (search.group ? { group: data && inboxGroups(data).find((g) => g.group_key === search.group), position: 0 } : null)

  useListKeys({
    ids: keys,
    selectedId: search.item,
    onSelect: selectKey,
    onOpen: (id) => {
      const it = items.find((i) => i.id === id)
      if (it?.claim) void navigate({ to: '/claims/$claimId', params: { claimId: it.claim.id }, search: { from: `inbox:${it.id}` } })
    },
    bindings: {
      a: selected && departed?.itemId !== selected.id ? () => doApprove(selected) : undefined,
      e: selected ? () => setPanel('edit') : undefined,
      r: selected ? () => setPanel('reject') : undefined,
      s: selected ? () => setPanel('snooze') : undefined,
      'shift+a': currentGroup?.group
        ? () => {
            const g = currentGroup.group
            if (g) doApproveGroup(g, items.filter((i) => g.item_ids.includes(i.id)))
          }
        : undefined,
      'g c': selected?.claim ? () => void navigate({ to: '/claims/$claimId', params: { claimId: selected.claim?.id ?? '' }, search: { from: `inbox:${selected.id}` } }) : undefined,
      escape: search.launch ? () => void select({ launch: undefined }) : undefined,
    },
  })

  const inboxOpen = navBadge(strip.data, 'inbox')
  const ranAlone = navBadge(strip.data, 'activity')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Inbox" sub={inboxOpen !== null ? `${plural(inboxOpen, 'item')} need you${items.length > 0 ? ` · ${inboxMix(items)}` : ''}` : undefined} />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[430px] flex-none flex-col border-r border-line">
          <div role="tablist" aria-label="Filter" className="flex gap-1 border-b border-line px-2.5 py-2 text-sm text-mid">
            {TABS.map((t) => {
              // Only the server's total: GET /inbox sends no per-kind facets, and the UI never counts.
              const n = t.kind ? undefined : data?.total
              const on = search.kind === t.kind
              return (
                <Link
                  key={t.label}
                  role="tab"
                  aria-selected={on}
                  from="/inbox"
                  to="/inbox"
                  search={(s) => ({ ...s, kind: t.kind, item: undefined, group: undefined })}
                  className={cn('rounded-xl px-2.5 py-0.5 no-underline', on ? 'bg-ink font-semibold text-white' : 'text-mid hover:text-ink')}
                >
                  {t.label}
                  {n !== undefined ? ` ${count(n)}` : ''}
                </Link>
              )
            })}
          </div>
          {list.isPending ? (
            <SkeletonRows rows={10} />
          ) : list.isError ? (
            <QueryError error={list.error} what="the Inbox" onRetry={() => void list.refetch()} />
          ) : !data || items.length === 0 ? (
            <EmptyState title="Nothing needs you" action={<Link to="/activity" className="font-semibold text-acc">See Activity →</Link>}>
              {ranAlone !== null ? `Agents handled ${count(ranAlone)} items this week without you.` : 'Agents are handling the rest.'}
            </EmptyState>
          ) : (
            <InboxListView
              list={data}
              selectedId={search.item}
              expandedGroup={search.group}
              keyCursor={search.item}
              onSelect={(id) => void select({ item: id, group: items.find((i) => i.id === id)?.group_key ?? undefined })}
              onOpenGroup={openGroup}
              onApproveGroup={doApproveGroup}
              approvingGroup={approveGroup.isPending ? approveGroup.variables.groupKey : undefined}
            />
          )}
          <RecentRuns active={search.launch} onOpen={(id) => void select({ launch: id })} />
          <KeyboardHints hints={[['J K', 'move'], ['A', 'approve'], ['E', 'edit'], ['R', 'reject'], ['S', 'snooze'], ['⇧A', 'group'], ['G C', 'claim']]} />
        </div>
        <div className={cn('flex min-w-0 flex-1 flex-col', list.isPlaceholderData && 'opacity-70')}>
          {launch && (
            <div className="flex-none px-5 pt-3.5">
              <ProgressPanel launch={launch} onClose={() => void select({ launch: undefined })} />
            </div>
          )}
          {selected ? (
            <InboxDetail
              key={selected.id}
              item={selected}
              group={group}
              panel={panel}
              setPanel={setPanel}
              now={now}
              departed={departed?.itemId === selected.id ? departed : null}
              busy={busy}
              onApprove={(edits) => doApprove(selected, edits)}
              onApproveGroup={() => {
                if (group) doApproveGroup(group.group, items.filter((i) => group.group.item_ids.includes(i.id)))
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
          ) : (
            !launch &&
            items.length > 0 && (
              <EmptyState title="Select an item">
                Use <b>J</b>/<b>K</b> to move through the queue, or click an item. Groups approve together with <b>⇧A</b>.
              </EmptyState>
            )
          )}
        </div>
      </div>
    </div>
  )
}
