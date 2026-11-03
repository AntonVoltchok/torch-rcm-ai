/**
 * Agent-written text is what the person is approving, so it reads here word for word with the evidence each
 * sentence rests on. Facts and the sentences around them stay apart: a sentence with no citation is the ask.
 */
import type { Draft } from './selectors'

export function DraftText({ draft, payer }: { draft: Draft; payer: string | null }) {
  return (
    <section aria-label="Draft text" data-testid="draft-text" className="rounded-lg border border-line bg-paper px-3 py-2.5">
      <h3 className="m-0 mb-1.5 text-sm font-bold">{payer ? `These words go to ${payer}` : 'These words go out'}</h3>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {draft.segments.map((s) => (
          <li key={s.text} data-testid="draft-segment">
            {s.text}
            {s.cites.map((title) => (
              <cite key={title} className="ml-1.5 inline-block rounded border border-line bg-fill px-1 text-xs not-italic text-mid">
                {title}
              </cite>
            ))}
          </li>
        ))}
      </ol>
      {draft.mustComplete.length > 0 && (
        <p className="m-0 mt-2 text-sm font-semibold text-warn" data-testid="draft-must-complete">
          You must complete: {draft.mustComplete.join('; ')}
        </p>
      )}
    </section>
  )
}
