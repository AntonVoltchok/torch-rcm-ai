/**
 * The one fetch wrapper. Every response is parsed with its Zod schema (drift fails loudly as
 * `schema_mismatch`), every error envelope becomes a typed `ApiError`, every mutation carries an
 * `Idempotency-Key`, and any `meta.counts` in a response is handed to `onCounts` (router.tsx decides where it goes).
 */
import type { z } from 'zod'
import { API_BASE } from '@/env'
import { session } from '@/state/session'
import { ErrorEnvelope, StripSummary } from './schema'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly alternatives: string[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
  is(code: string): boolean {
    return this.code === code
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code)

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[]
export type Query = Record<string, QueryValue>

export function buildUrl(path: string, query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`
}

let onCounts: (counts: StripSummary) => void = () => undefined
export function configureApi(opts: { onCounts: (counts: StripSummary) => void }): void {
  onCounts = opts.onCounts
}

export function authHeaders(): Record<string, string> {
  return { 'X-Torch-User': session.get().userId }
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID()
}

interface RequestOpts {
  query?: Query
  body?: unknown
  idempotencyKey?: string
  signal?: AbortSignal
}

async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S, opts: RequestOpts = {}): Promise<z.output<S>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() }
  const { userId } = session.get()
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey()

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      signal: opts.signal ?? null,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network', 'The Torch API is unreachable.')
  }

  const text = await res.text()
  const json: unknown = text ? safeJson(text) : null

  if (!res.ok) {
    const env = ErrorEnvelope.safeParse(json)
    if (env.success) {
      const details = env.data.error.details ?? {}
      const alts = env.data.alternatives ?? (Array.isArray(details.alternatives) ? details.alternatives.map(String) : [])
      throw new ApiError(res.status, env.data.error.code, env.data.error.message, details, alts)
    }
    throw new ApiError(res.status, `http_${res.status}`, `${method} ${path} failed (${res.status})`)
  }

  // The counts are the requester's and the strip's key has no user in it, so a switch while this was in flight voids them.
  if (session.get().userId === userId) pushCounts(json)
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.error(`[api] ${method} ${path} did not match its schema`, parsed.error.issues)
    throw new ApiError(res.status, 'schema_mismatch', `${method} ${path}: response did not match the contract`)
  }
  return parsed.data as z.output<S>
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function pushCounts(json: unknown): void {
  if (typeof json !== 'object' || json === null || !('meta' in json)) return
  const meta = json.meta
  if (typeof meta !== 'object' || meta === null || !('counts' in meta)) return
  const counts = StripSummary.safeParse(meta.counts)
  if (counts.success) onCounts(counts.data)
}

export const http = {
  get: <S extends z.ZodTypeAny>(path: string, schema: S, query?: Query, signal?: AbortSignal) =>
    request('GET', path, schema, { query, signal }),
  post: <S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, opts: Omit<RequestOpts, 'body'> = {}) =>
    request('POST', path, schema, { ...opts, body }),
  patch: <S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, opts: Omit<RequestOpts, 'body'> = {}) =>
    request('PATCH', path, schema, { ...opts, body }),
}
