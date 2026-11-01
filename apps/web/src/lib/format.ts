/**
 * Display formatting. Money arrives as integer cents and is only turned into dollars here.
 * Dates render in the practice's zone (America/New_York) whatever the browser's zone is.
 */
export const PRACTICE_TZ = 'America/New_York'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/** $1,240 for whole dollars, $27.20 when there are cents; negative as −$254. */
export function money(cents: number | null | undefined, opts: { cents?: 'auto' | 'always' | 'never' } = {}): string {
  if (cents === null || cents === undefined) return '—'
  if (!Number.isInteger(cents)) throw new Error(`money() expects integer cents, got ${cents}`)
  const mode = opts.cents ?? 'auto'
  const abs = Math.abs(cents)
  const showCents = mode === 'always' || (mode === 'auto' && abs % 100 !== 0)
  const body = (showCents ? usd2 : usd0).format(showCents ? abs / 100 : Math.round(abs / 100))
  return cents < 0 ? `−${body}` : body
}

/** Compact for tiles: $61,300 · $1.2M. */
export function moneyCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  if (Math.abs(cents) >= 100_000_000) return `$${(cents / 100_000_000).toFixed(1)}M`
  return money(cents, { cents: 'never' })
}

export function count(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n)
}

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${Math.round(n)}%`
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: PRACTICE_TZ, ...opts })
    fmtCache.set(key, f)
  }
  return f
}

/** Parse a server value. Date-only strings (YYYY-MM-DD) are calendar dates, pinned to noon in the practice zone. */
export function parseInstant(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00-05:00`)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`)
  return d
}

/** 10/28 */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  return fmt({ month: '2-digit', day: '2-digit' }).format(parseInstant(value))
}

/** 10/28/2026 */
export function longDate(value: string | null | undefined): string {
  if (!value) return '—'
  return fmt({ month: '2-digit', day: '2-digit', year: 'numeric' }).format(parseInstant(value))
}

/** 10:40 AM */
export function time(value: string | null | undefined): string {
  if (!value) return '—'
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(parseInstant(value))
}

/** 10/28 · 10:40 AM */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return `${shortDate(value)} · ${time(value)}`
}

/** Wed Oct 28 · 10:40 AM — the top-bar clock. */
export function clockLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const d = parseInstant(value)
  return `${fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '')} · ${time(value)}`
}

/** "Thu" */
export function weekday(value: string): string {
  return fmt({ weekday: 'short' }).format(parseInstant(value))
}

/** Practice-local calendar day YYYY-MM-DD of an instant. */
export function practiceDay(value: string): string {
  const parts = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(parseInstant(value))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Age buckets used by the Claims table (days since sent). Colour is semantic, not decorative. */
export type AgeTone = 'ok' | 'warn' | 'bad' | 'dark'
export function ageTone(days: number | null | undefined): AgeTone | null {
  if (days === null || days === undefined) return null
  if (days <= 30) return 'ok'
  if (days <= 60) return 'warn'
  if (days <= 90) return 'bad'
  return 'dark'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`
}

/** The ISO instant of a practice-local wall time (handles EDT/EST): nyInstant('2026-10-29', '07:10'). */
export function nyInstant(day: string, hhmm: string): string {
  for (const offset of ['-04:00', '-05:00']) {
    const iso = `${day}T${hhmm}:00${offset}`
    const d = new Date(iso)
    const local = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
    if (local === hhmm && practiceDay(iso) === day) return iso
  }
  return `${day}T${hhmm}:00-05:00`
}

/** Next calendar day (YYYY-MM-DD) after a practice-local day. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
