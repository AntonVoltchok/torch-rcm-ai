import { count, money } from '@/lib/format'

/**
 * A number in tour copy. Every count or amount the tour states goes through here, read from a server response by the
 * caller; `numbers.test.tsx` fails on any digit in step copy outside a `Num` that is not an allowlisted identifier.
 * Until the response arrives it reads "…", never a guess.
 */
export function Num({ v, as = 'count' }: { v: number | null | undefined; as?: 'count' | 'money' | 'raw' }) {
  const text = v === null || v === undefined ? '…' : as === 'money' ? money(v) : as === 'raw' ? String(v) : count(v)
  return (
    <b data-server-number="" className="font-semibold text-ink">
      {text}
    </b>
  )
}

/** Server text that may contain digits (a date, a label the server built). Marked like a number for the same test. */
export function Server({ t }: { t: string | null | undefined }) {
  return (
    <b data-server-number="" className="font-semibold text-ink">
      {t ?? '…'}
    </b>
  )
}
