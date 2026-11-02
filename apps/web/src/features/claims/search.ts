/**
 * /claims search params — the table's entire filter/sort/selection state lives in the URL.
 * Bad values fall back to "unset" (`.catch`) so a hand-edited or stale link still opens.
 */
import { z } from 'zod'
import { ClaimStatus, PayerKey, type ClaimStatus as TClaimStatus, type PayerKey as TPayerKey } from '@/api/schema'

export const AGE_BUCKETS = ['0_30', '31_60', '61_90', '90_plus'] as const
export const AgeBucket = z.enum(AGE_BUCKETS)
export type AgeBucket = z.infer<typeof AgeBucket>
export const AGE_LABEL: Record<AgeBucket, string> = { '0_30': '0–30 d', '31_60': '31–60 d', '61_90': '61–90 d', '90_plus': '90+ d' }

export const SORT_FIELDS = ['number', 'patient', 'payer', 'dos', 'billed', 'status', 'age', 'last_activity'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export const SortParam = z.enum([
  'number', '-number', 'patient', '-patient', 'payer', '-payer', 'dos', '-dos',
  'billed', '-billed', 'status', '-status', 'age', '-age', 'last_activity', '-last_activity',
])
export type SortParam = z.infer<typeof SortParam>
export const DEFAULT_SORT: SortParam = '-age'

/** `?status=denied` (one) or `?status=denied&status=pending` (many) — both become an array. */
const statusList = z.union([z.array(ClaimStatus), ClaimStatus.transform((s) => [s])])
/** `?flag=true` / `?flag=1`. */
export const boolParam = z.union([
  z.boolean(),
  z.enum(['true', '1']).transform(() => true),
  z.enum(['false', '0']).transform(() => false),
])

export const claimsSearchSchema = z.object({
  status: statusList.optional().catch(undefined),
  flag: boolParam.optional().catch(undefined),
  payer: PayerKey.optional().catch(undefined),
  provider: z.string().max(40).optional().catch(undefined),
  age: AgeBucket.optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  sort: SortParam.optional().catch(undefined),
  view: z.string().max(40).optional().catch(undefined),
  row: z.string().max(40).optional().catch(undefined),
})
export type ClaimsSearch = z.output<typeof claimsSearchSchema>

/** The subset of search params the API filters on (`view` and `row` don't change the data). */
export interface ClaimsApiParams {
  status?: TClaimStatus[] | undefined
  needs_action?: boolean | undefined
  payer?: TPayerKey | undefined
  provider?: string | undefined
  age_bucket?: AgeBucket | undefined
  q?: string | undefined
  sort: SortParam
}

export function toApiParams(s: ClaimsSearch): ClaimsApiParams {
  return {
    status: s.status && s.status.length > 0 ? [...s.status].sort() : undefined,
    needs_action: s.flag === true ? true : undefined,
    payer: s.payer,
    provider: s.provider,
    age_bucket: s.age,
    q: s.q || undefined,
    sort: s.sort ?? DEFAULT_SORT,
  }
}

/** The filter part of the search, as stored in a saved view. */
export function filtersOf(s: ClaimsSearch): Omit<ClaimsSearch, 'view' | 'row'> {
  const { view: _view, row: _row, ...rest } = s
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
}

export function parseSort(sort: SortParam): { field: SortField; desc: boolean } {
  const desc = sort.startsWith('-')
  return { field: (desc ? sort.slice(1) : sort) as SortField, desc }
}

export function toggleSort(current: SortParam, field: SortField): SortParam {
  const { field: f, desc } = parseSort(current)
  if (f !== field) return SortParam.parse(`-${field}`)
  return SortParam.parse(desc ? field : `-${field}`)
}
