/** Activity view logic over GET /activity rows (server-ordered, newest first). */
import type { ActivityOut, ActivityRow } from '@/api/schema'
import { nextDay, practiceDay } from '@/lib/format'

export const EVIDENCE_LABEL: Record<string, string> = {
  portal_screenshot: 'portal',
  ivr_transcript: 'IVR transcript',
  rep_call: 'rep call',
  era_line: '835 line',
  eob_pdf: 'EOB',
  pms_record: 'PMS record',
  nea_attachment: 'NEA#',
  policy_clause: 'policy',
  prior_eob: 'prior EOB',
  note_excerpt: 'clinical note',
}

export interface DayGroup {
  day: string
  /** The server's count of the day's rows in this response (`by_day`). */
  count: number
  rows: ActivityRow[]
}

/** The server's days (`by_day`, newest first), each with its rows picked by practice-local day, in server order. */
export function groupByDay(d: ActivityOut): DayGroup[] {
  return d.by_day.map((x) => ({ day: x.date, count: x.count, rows: d.rows.filter((r) => practiceDay(r.at) === x.date) }))
}

/** Monday of the server-clock week through today — the Day filter's options. */
export function weekDays(now: string): string[] {
  const today = practiceDay(now)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 = Sun
  const back = (dow + 6) % 7
  let d = today
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - back)
  d = start.toISOString().slice(0, 10)
  const days: string[] = []
  while (d <= today) {
    days.push(d)
    d = nextDay(d)
  }
  return days
}

/**
 * How a row is styled. A real `would_have_run` row (a rule in Observe) always reads "would have run". With the
 * Observe-mode preview on, everything an agent ran without review is shown as what Observe mode would have
 * logged instead — a presentation of the same server rows, labelled as a preview.
 */
export function rowStyle(r: ActivityRow, observePreview: boolean): 'would_have_run' | 'observe_preview' | 'awaiting' | 'person' | 'ran' {
  if (r.would_have_run) return 'would_have_run'
  if (r.agent === null) return 'person'
  if (r.awaiting_you) return 'awaiting'
  return observePreview ? 'observe_preview' : 'ran'
}
