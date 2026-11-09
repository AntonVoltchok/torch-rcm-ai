import { describe, expect, it } from 'vitest'
import { InboxList } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { GROUP_DELTA_PA } from '@/mocks/fixtures/inbox'
import { draftOf, entries, groupLands, inboxGroups, isBlocked, itemOrder, keyOrder, nextSelection, withoutItems } from './selectors'

const list = () => InboxList.parse(new MockDb({ stepDelayMs: 0, schedule: () => undefined }).inbox({}))

describe('inbox selectors', () => {
  it('blocks only what the server marks with a signer note, and a batch lands where its members do', () => {
    const { items, groups } = InboxList.parse(new MockDb().inbox({}))
    expect(items).toHaveLength(12)
    expect(items.filter(isBlocked).map((i) => i.id)).toEqual(['itm_4611'])
    const g = groups?.[0]
    expect(g && groupLands(items.filter((i) => g.item_ids.includes(i.id)))).toBe('agents')
  })

  it('reads a draft with the evidence each sentence cites', () => {
    const evidence = [{ id: 'ev_a', title: 'Delta EOB · 03/2022' }] as Parameters<typeof draftOf>[1]
    const payload = { draft: { segments: [{ text: 'Crown was on #31.', evidence_ids: ['ev_a', 'ev_gone'] }, { text: 'Please reprocess.', evidence_ids: [] }], human_must_complete: ['sign below'] } }
    expect(draftOf(payload, evidence)).toEqual({
      segments: [{ text: 'Crown was on #31.', cites: ['Delta EOB · 03/2022'] }, { text: 'Please reprocess.', cites: [] }],
      mustComplete: ['sign below'],
    })
    expect(draftOf({ root_cause: 'ours' }, evidence)).toBeNull()
  })

  it('shows the Delta group once, first, with its three members', () => {
    const e = entries(list())
    expect(e).toHaveLength(10)
    const first = e[0]
    expect(first?.type).toBe('group')
    if (first?.type === 'group') {
      expect(first.group.count).toBe(3)
      expect(first.group.cents).toBe(373_000)
      expect(first.members.map((m) => m.id)).toEqual(['itm_4821', 'itm_4836', 'itm_4840'])
    }
  })

  it('treats a collapsed group as one keyboard stop and an expanded one as its members', () => {
    expect(keyOrder(list(), undefined).slice(0, 2)).toEqual([`group:${GROUP_DELTA_PA}`, 'itm_4733'])
    expect(keyOrder(list(), GROUP_DELTA_PA).slice(0, 4)).toEqual(['itm_4821', 'itm_4836', 'itm_4840', 'itm_4733'])
  })

  it('moves the selection to the next item after a group leaves', () => {
    const order = itemOrder(list())
    expect(nextSelection(order, ['itm_4821', 'itm_4836', 'itm_4840'], 'itm_4821')).toBe('itm_4733')
    expect(nextSelection(order, ['itm_elig_park'], 'itm_elig_park')).toBe('itm_elig_kim')
    expect(nextSelection(['a'], ['a'], 'a')).toBeUndefined()
  })

  it('projects the optimistic removal: the group shrinks, then vanishes', () => {
    const one = withoutItems(list(), ['itm_4821'])
    expect(one.total).toBe(11)
    expect(inboxGroups(one)[0]).toMatchObject({ count: 2, cents: 249_000 })
    const all = withoutItems(list(), ['itm_4821', 'itm_4836', 'itm_4840'])
    expect(all.total).toBe(9)
    expect(inboxGroups(all)).toHaveLength(0)
  })
})
