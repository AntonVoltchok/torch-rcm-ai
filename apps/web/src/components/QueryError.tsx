import { isApiError } from '@/api/client'

/** Inline, per-query error with retry. Never a blank screen. */
export function QueryError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const message = isApiError(error) ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="m-3 flex items-center gap-3 rounded-md border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad">
      <span>
        Couldn’t load {what}. {message}
      </span>
      <button type="button" onClick={onRetry} className="ml-auto font-bold underline">
        Retry
      </button>
    </div>
  )
}
