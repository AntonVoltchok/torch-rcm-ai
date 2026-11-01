/** Confidence never travels without its basis ("23 of 25 paid within 30 d"); no base rate → no number. */
export function ConfidenceMeter({ pct, basis, compact = false }: { pct: number | null; basis?: string | undefined; compact?: boolean }) {
  if (pct === null) {
    return (
      <span className="text-xs text-mid" title={basis}>
        no base rate{!compact && basis ? ` — ${basis}` : ''}
      </span>
    )
  }
  const tone = pct >= 85 ? 'bg-ok' : 'bg-[#c88a00]'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mid" title={basis}>
      <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded bg-light">
        <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <b className="text-ink">{Math.round(pct)}%</b>
      {!compact && basis && <span>— {basis}</span>}
    </span>
  )
}
