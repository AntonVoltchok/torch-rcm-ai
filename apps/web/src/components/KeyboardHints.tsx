import { Kbd } from './ui/Kbd'

export function KeyboardHints({ hints }: { hints: [string, string][] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-fill px-3 py-1.5 text-xs text-mid" aria-label="Keyboard shortcuts">
      {hints.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1">
          {k.split(' ').map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
          {label}
        </span>
      ))}
    </div>
  )
}
