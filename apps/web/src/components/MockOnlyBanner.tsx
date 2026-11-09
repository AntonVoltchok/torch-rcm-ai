/**
 * Mock-only routes: the designed screen from docs/design/mocks.html (copied to public/design/) with an
 * honest banner. No dead links: the route exists, and it says what it is.
 */
export function MockOnlyBanner({ title, anchor, note }: { title: string; anchor: string; note?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="note" className="flex items-center gap-3 border-b border-line bg-fill px-4 py-2.5 text-sm text-mid">
        <b className="text-ink">Designed, not built in this demo.</b>
        <span>{note ?? `${title} is shown as the reviewed design. Every other screen in the sidebar reads the live API.`}</span>
        <a href={`/design/mocks.html#${anchor}`} target="_blank" rel="noreferrer" className="ml-auto whitespace-nowrap font-medium text-act underline underline-offset-2">
          Open the design ↗
        </a>
      </div>
      <iframe title={`${title} — design`} src={`/design/mocks.html#${anchor}`} className="min-h-0 w-full flex-1 border-0 bg-[#eceef0]" />
    </div>
  )
}
