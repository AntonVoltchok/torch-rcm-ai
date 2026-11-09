import { isApiError } from '@/api/client'

/** Inline, per-query error with retry. Never a blank screen. */
export function QueryError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const message = isApiError(error) ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="m-3 flex items-center gap-3 rounded-lg border border-risk-line bg-risk-bg px-3 py-2 text-sm text-risk-ink">
      <span>
        Couldn’t load {what}. {message}
      </span>
      <button type="button" onClick={onRetry} className="ml-auto font-semibold underline underline-offset-2">
        Retry
      </button>
    </div>
  )
}
