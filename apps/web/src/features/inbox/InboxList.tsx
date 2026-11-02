import type { InboxGroup, InboxItem, InboxItemKind, InboxList as TInboxList } from '@/api/schema'
import { money } from '@/lib/format'
import { PAYER_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ConfidenceMeter } from '@/components/ConfidenceMeter'
import { entries, groupRowId } from './selectors'

const KIND_LABEL: Record<InboxItemKind, { label: string; tone: string }> = {
  approve_action: { label: 'Approve', tone: 'text-acc' },
  review_draft: { label: 'Review draft', tone: 'text-acc' },
  eligibility_flag: { label: 'Eligibility', tone: 'text-warn' },
  variance: { label: 'Variance', tone: 'text-ok' },
  run_failed: { label: 'Run failed', tone: 'text-bad' },
  rule_proposal: { label: 'Proposal', tone: 'text-mid' },
  owner_signoff: { label: 'Sign-off', tone: 'text-mid' },
}

function typeLabel(item: InboxItem): { label: string; tone: string } {
  if (item.kind === 'approve_action' && item.claim && /denied|CO-|PR-/i.test(item.summary ?? '')) return { label: 'Denial', tone: 'text-bad' }
  return KIND_LABEL[item.kind]
}

function ItemRow({ item, selected, onSelect, nested = false }: { item: InboxItem; selected: boolean; onSelect: () => void; nested?: boolean }) {
  const t = typeLabel(item)
  return (
    <li>
      <button
        type="button"
        data-item-id={item.id}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'block w-full border-b border-l-[3px] border-b-light border-l-transparent px-3 py-2 text-left hover:bg-fill',
          nested && 'pl-6',
          selected && 'border-l-acc bg-acc-bg hover:bg-acc-bg',
        )}
      >
        <span className="flex items-center gap-1.5">
          {!nested && <span className={cn('w-[76px] flex-none text-[10px] font-extrabold uppercase tracking-[.04em]', t.tone)}>{t.label}</span>}
          <span className="truncate font-bold">{item.title}</span>
          <span className="ml-auto font-bold">{money(item.cents)}</span>
        </span>
        {!nested && item.summary && <span className="mb-0.5 mt-0.5 block text-sm leading-[1.3] text-ink">{item.summary}</span>}
        <span className="flex items-center gap-2 text-xs text-soft">
          {item.confidence && <ConfidenceMeter pct={item.confidence.pct} compact />}
          {item.claim && <span>{PAYER_NAME[item.claim.payer.key]}</span>}
        </span>
      </button>
    </li>
  )
}

function GroupBlock(props: {
  group: InboxGroup
  members: InboxItem[]
  expanded: boolean
  selectedId: string | undefined
  keySelected: boolean
  onOpen: () => void
  onSelect: (id: string) => void
  onApproveGroup: () => void
  approving: boolean
}) {
  const { group, members, expanded, selectedId } = props
  return (
    <li className={cn('border-b border-light', props.keySelected && 'bg-acc-bg')} data-group-key={group.group_key}>
      <div className="px-3 pb-1.5 pt-2">
        <button type="button" onClick={props.onOpen} aria-expanded={expanded} className="block w-full text-left" data-item-id={groupRowId(group.group_key)}>
          <span className="flex items-center gap-1.5">
            <span className="w-[76px] flex-none text-[10px] font-extrabold uppercase tracking-[.04em] text-bad">Denial ×{group.count}</span>
            <span className="truncate font-bold">
              {group.title} ({group.count})
            </span>
            <span className="ml-auto font-bold">{money(group.cents)}</span>
          </span>
        </button>
        <div className="mt-1.5 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={props.onApproveGroup} disabled={props.approving} kbd="⇧A">
            Approve {group.count}
          </Button>
          <button type="button" className="text-xs font-semibold text-acc hover:underline" onClick={props.onOpen}>
            {expanded ? 'Reviewing one by one' : 'Review one by one'}
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="m-0 list-none p-0">
          {members.map((m) => (
            <ItemRow key={m.id} item={m} nested selected={m.id === selectedId} onSelect={() => props.onSelect(m.id)} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function InboxListView(props: {
  list: TInboxList
  selectedId: string | undefined
  expandedGroup: string | undefined
  keyCursor: string | undefined
  onSelect: (id: string) => void
  onOpenGroup: (g: InboxGroup) => void
  onApproveGroup: (g: InboxGroup, members: InboxItem[]) => void
  approvingGroup: string | undefined
}) {
  return (
    <ul aria-label="Inbox items" className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
      {entries(props.list).map((e) =>
        e.type === 'item' ? (
          <ItemRow key={e.item.id} item={e.item} selected={e.item.id === props.selectedId} onSelect={() => props.onSelect(e.item.id)} />
        ) : (
          <GroupBlock
            key={e.group.group_key}
            group={e.group}
            members={e.members}
            expanded={props.expandedGroup === e.group.group_key}
            selectedId={props.selectedId}
            keySelected={props.keyCursor === groupRowId(e.group.group_key)}
            onOpen={() => props.onOpenGroup(e.group)}
            onSelect={props.onSelect}
            onApproveGroup={() => props.onApproveGroup(e.group, e.members)}
            approving={props.approvingGroup === e.group.group_key}
          />
        ),
      )}
    </ul>
  )
}
