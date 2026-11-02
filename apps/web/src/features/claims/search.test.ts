import { describe, expect, it } from 'vitest'
import { parseSearch, stringifySearch } from '@/lib/searchSerde'
import { inboxSearchSchema } from '@/features/inbox/search'
import { claimSearchSchema, parseFrom } from '@/features/claim/search'
import { claimsSearchSchema, filtersOf, toApiParams, toggleSort } from './search'

const fromUrl = (qs: string) => claimsSearchSchema.parse(parseSearch(qs))

describe('claims search params', () => {
  it('reads the strip-tile link /claims?status=denied as a one-element array', () => {
    expect(fromUrl('?status=denied')).toMatchObject({ status: ['denied'] })
  })

  it('reads repeated keys as an array and keeps them stable for the query key', () => {
    const s = fromUrl('?status=pending&status=denied&flag=true&sort=-billed')
    expect(s.status).toEqual(['pending', 'denied'])
    expect(s.flag).toBe(true)
    expect(toApiParams(s)).toEqual({
      status: ['denied', 'pending'],
      needs_action: true,
      payer: undefined,
      provider: undefined,
      age_bucket: undefined,
      q: undefined,
      sort: '-billed',
    })
  })

  it('drops invalid values instead of failing the route (stale or hand-edited links still open)', () => {
    const s = fromUrl('?status=bogus&payer=acme&age=old&sort=-color&flag=maybe')
    expect(s).toEqual({ status: undefined, payer: undefined, age: undefined, sort: undefined, flag: undefined, provider: undefined, q: undefined, view: undefined, row: undefined })
    expect(toApiParams(s).sort).toBe('-age')
  })

  it('round-trips through the URL serialiser with readable params', () => {
    const qs = stringifySearch({ status: ['denied'], flag: true, q: '4821', view: undefined })
    expect(qs).toBe('?status=denied&flag=true&q=4821')
    expect(fromUrl(qs)).toMatchObject({ status: ['denied'], flag: true, q: '4821' })
  })

  it('keeps `view` and `row` out of the API params and out of saved views', () => {
    const s = fromUrl('?status=denied&view=view_1&row=clm_4733')
    expect(filtersOf(s)).toEqual({ status: ['denied'] })
    expect(toApiParams(s)).not.toHaveProperty('row')
  })

  it('toggles sort: new field descending first, same field flips', () => {
    expect(toggleSort('-age', 'billed')).toBe('-billed')
    expect(toggleSort('-billed', 'billed')).toBe('billed')
    expect(toggleSort('billed', 'billed')).toBe('-billed')
  })
})

describe('inbox and claim search params', () => {
  it('keeps the selected item, group and run panel in the URL', () => {
    expect(inboxSearchSchema.parse(parseSearch('?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment&launch=run_1'))).toEqual({
      item: 'itm_4821',
      group: 'delta_ny:resubmit_with_attachment',
      launch: 'run_1',
      state: undefined,
      kind: undefined,
      agent: undefined,
    })
  })

  it('rejects unknown inbox kinds', () => {
    expect(inboxSearchSchema.parse({ kind: 'everything' }).kind).toBeUndefined()
  })

  it('parses the breadcrumb origin', () => {
    expect(parseFrom(claimSearchSchema.parse({ from: 'inbox:itm_4821' }).from)).toEqual({ kind: 'inbox', itemId: 'itm_4821' })
    expect(claimSearchSchema.parse({ from: 'javascript:alert(1)' }).from).toBeUndefined()
  })
})
