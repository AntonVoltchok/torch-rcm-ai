/**
 * Pure selectors over the cached GET /inbox response. The server orders items by priority and
 * groups them; these functions only arrange that for display and keyboard order. No counting:
 * group counts and cents are the server's.
 */
import type { InboxGroup, InboxItem, InboxList } from '@/api/schema'

/** The API sends `groups` only for `?group=true`; every list here asks for them, so absent means none. */
export const inboxGroups = (list: InboxList): InboxGroup[] => list.groups ?? []

export type Entry = { type: 'item'; item: InboxItem } | { type: 'group'; group: InboxGroup; members: InboxItem[] }

/** Items in server order; a group appears once, where its first member would be. */
export function entries(list: InboxList): Entry[] {
  const byId = new Map(list.items.map((i) => [i.id, i]))
  const groupOf = new Map<string, InboxGroup>()
  for (const g of inboxGroups(list)) for (const id of g.item_ids) groupOf.set(id, g)
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const item of list.items) {
    const g = groupOf.get(item.id)
    if (!g) {
      out.push({ type: 'item', item })
      continue
    }
    if (seen.has(g.group_key)) continue
    seen.add(g.group_key)
    out.push({ type: 'group', group: g, members: g.item_ids.map((id) => byId.get(id)).filter((i): i is InboxItem => Boolean(i)) })
  }
  return out
}

export const groupRowId = (key: string) => `group:${key}`

/** j/k order: a collapsed group is one stop; an expanded group is its members. */
export function keyOrder(list: InboxList, expandedGroup: string | undefined): string[] {
  return entries(list).flatMap((e) =>
    e.type === 'item' ? [e.item.id] : e.group.group_key === expandedGroup ? e.members.map((m) => m.id) : [groupRowId(e.group.group_key)],
  )
}

/** Every item id in display order (used to pick the next selection after a removal). */
export function itemOrder(list: InboxList): string[] {
  return entries(list).flatMap((e) => (e.type === 'item' ? [e.item.id] : e.members.map((m) => m.id)))
}

/** After removing `removed`, select the next item below; at the end, the one above; else nothing. */
export function nextSelection(order: readonly string[], removed: readonly string[], current: string | undefined): string | undefined {
  const gone = new Set(removed)
  const anchor = current && order.includes(current) ? order.indexOf(current) : order.findIndex((id) => gone.has(id))
  if (anchor === -1) return order.find((id) => !gone.has(id))
  for (let i = anchor; i < order.length; i++) if (!gone.has(order[i] ?? '')) return order[i]
  for (let i = anchor; i >= 0; i--) if (!gone.has(order[i] ?? '')) return order[i]
  return undefined
}

export function groupFor(list: InboxList | undefined, item: InboxItem | undefined): { group: InboxGroup; position: number } | null {
  if (!list || !item?.group_key) return null
  const group = inboxGroups(list).find((g) => g.group_key === item.group_key)
  if (!group) return null
  return { group, position: group.item_ids.indexOf(item.id) + 1 }
}

/** The list without `ids` — the optimistic projection after Approve/Reject/Snooze. Groups shrink with their members. */
export function withoutItems(list: InboxList, ids: readonly string[]): InboxList {
  const drop = new Set(ids)
  const removed = list.items.filter((i) => drop.has(i.id))
  const removedCents = new Map(removed.map((i) => [i.id, i.cents]))
  return {
    ...list,
    items: list.items.filter((i) => !drop.has(i.id)),
    total: Math.max(0, list.total - removed.length),
    total_cents: Math.max(0, list.total_cents - removed.reduce((a, i) => a + i.cents, 0)),
    groups: inboxGroups(list)
      .map((g) => {
        const gone = g.item_ids.filter((id) => drop.has(id))
        const count = g.count - gone.length
        return {
          ...g,
          title: g.title.replace(/\(\d+\)$/, `(${count})`), // the API's title carries the count
          item_ids: g.item_ids.filter((id) => !drop.has(id)),
          count,
          cents: g.cents - gone.reduce((a, id) => a + (removedCents.get(id) ?? 0), 0),
        }
      })
      .filter((g) => g.count > 1),
  }
}
