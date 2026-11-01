import { describe, expect, it } from 'vitest'
import { parseSearch, stringifySearch } from '@/lib/searchSerde'
import { eligibilitySearchSchema } from '@/features/eligibility/search'
import { settingsSearchSchema } from '@/features/settings/search'
import { activitySearchSchema } from './search'

describe('S2 search params', () => {
  it('reads Activity filters and the Observe-mode preview from readable params', () => {
    expect(activitySearchSchema.parse(parseSearch('?day=2026-10-28&agent=followup&outcome=would_have_run&observe=true'))).toEqual({
      day: '2026-10-28',
      agent: 'followup',
      outcome: 'would_have_run',
      observe: true,
    })
    expect(stringifySearch({ agent: 'followup', observe: true, day: undefined })).toBe('?agent=followup&observe=true')
  })

  it('drops invalid Activity values instead of failing the route', () => {
    expect(activitySearchSchema.parse(parseSearch('?day=yesterday&agent=robot&outcome=maybe&observe=perhaps'))).toEqual({
      day: undefined,
      agent: undefined,
      outcome: undefined,
      observe: undefined,
    })
  })

  it('keeps the eligibility day and selected appointment in the URL', () => {
    expect(eligibilitySearchSchema.parse(parseSearch('?date=2026-10-29&appt=appt_chen_1029'))).toEqual({ date: '2026-10-29', appt: 'appt_chen_1029' })
    expect(eligibilitySearchSchema.parse({ appt: '<script>' }).appt).toBeUndefined()
  })

  it('keeps the Settings tab and selected rule in the URL; unknown tabs fall back to Rules', () => {
    expect(settingsSearchSchema.parse(parseSearch('?tab=proposals&rule=rule_t1_delta_pa'))).toEqual({ tab: 'proposals', rule: 'rule_t1_delta_pa' })
    expect(settingsSearchSchema.parse(parseSearch('?tab=secrets')).tab).toBeUndefined()
  })
})
