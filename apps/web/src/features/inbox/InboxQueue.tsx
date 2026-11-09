/**
 * D1's queue: "Yours" with its filter tabs, the baton key, your rows (groups collapse to one), the items someone else
 * signs, and the runs this tab started. Every baton is the server's: a claim row draws `claim.move` with a dashed ghost
 * at `lands`; an item with no claim (an upcoming visit) is with you because it is in your Inbox. Nothing here counts
 * money or claims; the group's count and cents are the server's.
 */
import { Link } from '@tanstack/react-router'
import type { InboxGroup, InboxItem, InboxList } from '@/api/schema'
import { money } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Baton, BatonLegend, batonProps } from '@/components/Baton'
import { entries, groupLands, groupRowId, isBlocked, waitingSections, type Entry } from './selectors'
import { INBOX_TABS } from './search'
import { RecentRuns } from './RecentRuns'

const rowBase =
  'grid w-[calc(100%-16px)] mx-2 grid-cols-[66px_1fr_auto] items-center gap-x-3 rounded-lg px-2 text-left focus-visible:outline-2 focus-visible:outline-act'
const rowSel = 'bg-act-bg shadow-[inset_0_0_0_1px_var(--color-act-line)]'

function ItemBaton({ item }: { item: InboxItem }) {
  const blocked = isBlocked(item)
  if (item.claim) return <Baton {...batonProps(item.claim.move)} next={blocked ? null : item.lands} className="row-span-2" />
  return <Baton who="practice" next={item.lands} label="With you: an upcoming visit" className="row-span-2" />
}

function ItemRow({ item, selected, member = false, onSelect }: { item: InboxItem; selected: boolean; member?: boolean; onSelect: () => void }) {
  const c = item.claim
  return (
    <button
      type="button"
      data-item-id={item.id}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(rowBase, member ? 'min-h-9 py-1' : 'min-h-[52px] py-[7px]', selected ? rowSel : 'hover:bg-hover')}
    >
      <ItemBaton item={item} />
      <span className="col-start-2 min-w-0 truncate">
        <span className="font-semibold">{item.patient?.display_name ?? c?.patient.display_name ?? item.title}</span>
        {c && <span className="text-mid"> #{c.number}</span>}
        <span className="text-mid"> {c ? c.procedures_plain : 'Upcoming visit'}</span>
      </span>
      <span className="col-start-3 row-start-1 font-medium tabular-nums">{money(item.cents)}</span>
      {!member && <span className="col-span-2 col-start-2 row-start-2 truncate text-sm text-mid">{item.signer_note ?? item.headline}</span>}
    </button>
  )
}

function GroupRows(p: { entry: Extract<Entry, { type: 'group' }>; expanded: boolean; selectedId: string | undefined; keyOnGroup: boolean; onOpen: () => void; onSelect: (id: string) => void }) {
  const { group, members } = p.entry
  const memberSelected = members.some((m) => m.id === p.selectedId)
  return (
    <div data-group-key={group.group_key} className={cn(p.expanded && 'pb-1')}>
      <button
        type="button"
        data-item-id={groupRowId(group.group_key)}
        aria-expanded={p.expanded}
        onClick={p.onOpen}
        className={cn(rowBase, 'min-h-11 py-[7px]', p.keyOnGroup || (memberSelected && !p.expanded) ? rowSel : 'hover:bg-hover')}
      >
        <Baton who="practice" count={group.count} next={groupLands(members)} label={`${group.count} claims with you`} />
        <span className="col-start-2 min-w-0 truncate font-semibold">{group.title}</span>
        <span className="col-start-3 font-medium tabular-nums">{money(group.cents)}</span>
      </button>
      {p.expanded && members.map((m) => <ItemRow key={m.id} item={m} member selected={m.id === p.selectedId} onSelect={() => p.onSelect(m.id)} />)}
    </div>
  )
}

export function InboxQueue(props: {
  list: InboxList | undefined
  body: React.ReactNode
  kind: string | undefined
  selectedId: string | undefined
  expandedGroup: string | undefined
  keyCursor: string | undefined
  activeLaunch: string | undefined
  onSelect: (id: string) => void
  onOpenGroup: (g: InboxGroup) => void
  onOpenLaunch: (id: string) => void
}) {
  const all = props.list ? entries(props.list) : []
  // Who waits on whom is the server's (`InboxList.waiting`); the rest of the list is the viewer's.
  const sections = props.list ? waitingSections(props.list) : []
  const waitingIds = new Set(sections.flatMap((s) => s.items.map((i) => i.id)))
  const mine = all.filter((e) => e.type === 'group' || !waitingIds.has(e.item.id))
  return (
    <aside aria-label="Your queue" className="panel flex min-h-0 flex-col overflow-y-auto pb-2">
      <div className="sticky top-0 z-[2] flex items-center justify-between gap-3 rounded-t-[10px] bg-paper px-4 pb-2 pt-3">
        <h2 className="m-0 text-md font-semibold">Yours</h2>
        <div role="tablist" aria-label="Filter" className="flex gap-0.5 text-sm text-mid">
          {INBOX_TABS.map((t) => {
            const on = props.kind === t.kind
            // Only the server's count of what is yours: GET /inbox sends no per-kind facets, and the UI never counts.
            const n = t.kind ? undefined : props.list?.actionable
            return (
              <Link
                key={t.label}
                role="tab"
                aria-selected={on}
                from="/inbox"
                to="/inbox"
                search={(s) => ({ ...s, kind: t.kind, item: undefined, group: undefined, launch: undefined })}
                className={cn('rounded-md px-2 py-0.5 no-underline hover:bg-hover', on ? 'bg-hover font-medium text-ink' : 'text-mid')}
              >
                {t.label}
                {n !== undefined && <span className="ml-1 text-soft">{n}</span>}
              </Link>
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pb-2 text-xs text-soft">
        <BatonLegend />
        <span>Dashed is where it goes next</span>
      </div>
      {props.body ?? (
        <>
          <div role="list" aria-label="Inbox items">
            {mine.map((e) =>
              e.type === 'item' ? (
                <div role="listitem" key={e.item.id}>
                  <ItemRow item={e.item} selected={e.item.id === props.selectedId} onSelect={() => props.onSelect(e.item.id)} />
                </div>
              ) : (
                <div role="listitem" key={e.group.group_key}>
                  <GroupRows
                    entry={e}
                    expanded={props.expandedGroup === e.group.group_key}
                    selectedId={props.selectedId}
                    keyOnGroup={props.keyCursor === groupRowId(e.group.group_key)}
                    onOpen={() => props.onOpenGroup(e.group)}
                    onSelect={props.onSelect}
                  />
                </div>
              ),
            )}
          </div>
          {mine.length === 0 && sections.length > 0 && <p className="m-0 px-4 py-3 text-mid">Nothing of this kind is waiting on you.</p>}
          {sections.map(({ row, items }) => (
            <section key={row.signer_ids.join(',')} aria-label={`Waiting on ${row.label}`} data-testid="inbox-waiting">
              <h3 className="mx-4 mb-1 mt-2 flex justify-between gap-3 border-t border-line pt-2.5 text-sm font-normal text-mid">
                <span>
                  Waiting on {row.label} · {row.count}
                </span>
                <span className="tabular-nums">{money(row.cents)}</span>
              </h3>
              {items.map((it) => (
                <ItemRow key={it.id} item={it} selected={it.id === props.selectedId} onSelect={() => props.onSelect(it.id)} />
              ))}
            </section>
          ))}
        </>
      )}
      <RecentRuns active={props.activeLaunch} onOpen={props.onOpenLaunch} />
    </aside>
  )
}
