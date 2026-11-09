import { Kbd } from './ui/Kbd'

export function KeyboardHints({ hints }: { hints: [string, string][] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line bg-paper px-4 py-2 text-xs text-soft" aria-label="Keyboard shortcuts">
      {hints.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {k.split(' ').map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
          {label}
        </span>
      ))}
    </div>
  )
}
