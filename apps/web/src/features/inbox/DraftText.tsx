/**
 * Agent-written text is what the person is approving, so it reads here word for word with the evidence each
 * sentence rests on. Facts and the sentences around them stay apart: a sentence with no citation is the ask.
 */
import { plural } from '@/lib/format'
import type { Draft } from './selectors'

export function DraftText({ draft, payer }: { draft: Draft; payer: string | null }) {
  const cited = draft.segments.filter((s) => s.cites.length > 0).length
  return (
    <section aria-label="Draft text" data-testid="draft-text" className="mt-4">
      <h3 className="m-0 text-base font-semibold">
        {payer ? `The note that goes to ${payer}` : 'The note that goes out'}
        <span className="ml-1.5 text-sm font-normal text-mid">
          {plural(draft.segments.length, 'sentence')}, {cited} cited. Read every word: you are approving this text.
        </span>
      </h3>
      <ol className="m-0 mt-1.5 list-none rounded-lg border border-line p-0">
        {draft.segments.map((s) => (
          <li key={s.text} data-testid="draft-segment" className="grid grid-cols-[1fr_168px] gap-4 border-b border-line px-3 py-2 last:border-b-0">
            <span>{s.text}</span>
            <span className="text-xs leading-[1.4] text-soft">
              {s.cites.length > 0
                ? s.cites.map((t) => (
                    <cite key={t} className="block not-italic">
                      {t}
                    </cite>
                  ))
                : 'No citation: the request itself'}
            </span>
          </li>
        ))}
      </ol>
      {draft.mustComplete.length > 0 && (
        <p className="m-0 mt-2 rounded-md border border-practice-line bg-practice-bg px-3 py-2 text-sm font-medium" data-testid="draft-must-complete">
          You must complete: {draft.mustComplete.join('; ')}
        </p>
      )}
    </section>
  )
}
