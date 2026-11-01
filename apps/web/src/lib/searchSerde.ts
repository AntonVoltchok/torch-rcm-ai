/**
 * URL ⇄ search-object serialisation for the router.
 *
 * TanStack Router's default JSON-in-the-query format would render `/claims?status=%5B%22denied%22%5D`.
 * We keep URLs readable and shareable (`/claims?status=denied&status=pending&flag=true`): repeated keys
 * become arrays, everything else stays a string, and each route's Zod `validateSearch` does the typing.
 */
export type RawSearch = Record<string, string | string[]>

export function parseSearch(searchStr: string): RawSearch {
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)
  const out: RawSearch = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    out[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return out
}

function scalar(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const s = scalar(v)
        if (s !== null) params.append(key, s)
      }
    } else {
      const s = scalar(value)
      if (s !== null) params.set(key, s)
    }
  }
  const str = params.toString()
  return str ? `?${str}` : ''
}
