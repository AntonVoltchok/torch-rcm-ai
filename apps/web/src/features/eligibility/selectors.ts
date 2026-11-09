/** Eligibility view logic over GET /eligibility: every count is the server's (`total`, `by_day`). */
import type { EligibilityDay, EligibilityOut, EligibilityRow } from '@/api/schema'
import { count, plural, practiceDay } from '@/lib/format'

/** The server's days (`by_day`, zeros included), each with its rows picked by practice-local date, in time order. */
export function byDay(d: EligibilityOut): { day: string; tally: EligibilityDay; rows: EligibilityRow[] }[] {
  const rows = [...d.rows].sort((a, b) => a.start.localeCompare(b.start))
  return d.by_day.map((tally) => ({ day: tally.date, tally, rows: rows.filter((r) => practiceDay(r.start) === tally.date) }))
}

/** "6 appts · 3 verified · 2 need attention · 1 checking": the server's per-day counts, zero statuses left out. */
export function dayLine(t: EligibilityDay): string {
  if (t.count === 0) return 'No appointments booked'
  const parts = [
    t.verified && `${count(t.verified)} verified`,
    t.issue && `${count(t.issue)} ${t.issue === 1 ? 'needs' : 'need'} attention`,
    t.unverified && `${count(t.unverified)} not verified`,
    t.checking && `${count(t.checking)} checking`,
  ].filter(Boolean)
  return [plural(t.count, 'appt'), ...parts].join(' · ')
}
