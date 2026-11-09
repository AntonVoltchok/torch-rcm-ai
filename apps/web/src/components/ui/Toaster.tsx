import { useRouter } from '@tanstack/react-router'
import { dismiss, useToasts } from '@/state/toast'
import { cn } from '@/lib/cn'

const TONE = { info: 'text-white', ok: 'text-[#7fe0a5]', warn: 'text-white', bad: 'text-[#ff9b8f]' } as const

export function Toaster() {
  const toasts = useToasts()
  const router = useRouter()
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-lg bg-ink px-3 py-2 text-base text-white shadow-lg">
          <span className={cn('font-bold', TONE[t.tone])}>{t.tone === 'bad' ? '✕' : t.tone === 'warn' ? '!' : '✓'}</span>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="ml-auto font-bold underline"
              onClick={() => {
                dismiss(t.id)
                void router.navigate({ href: t.action?.href ?? '/inbox' })
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="ml-1 text-white/60 hover:text-white" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
