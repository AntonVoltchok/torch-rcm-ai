/**
 * Mock-only routes: the designed screen from docs/design/mocks.html (copied to public/design/) with an
 * honest banner. No dead links: the route exists, and it says what it is. `?frame=` makes the design page show only
 * that screen (no rounds, notes or its own sidebar), in the iframe and behind "Open the design".
 */
import { NAV } from '@/features/shell/nav'

const MOCK_SCREENS = NAV.filter((n) => n.status === 'mock').map((n) => n.label)
const listed = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''))

const designUrl = (anchor: string) => `/design/mocks.html?frame=${encodeURIComponent(anchor)}`

export function MockOnlyBanner({ title, anchor, note }: { title: string; anchor: string; note?: string }) {
  const src = designUrl(anchor)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="note" className="flex items-center gap-3 border-b border-line bg-fill px-4 py-2.5 text-sm text-mid">
        <b className="text-ink">Designed, not built in this demo.</b>
        <span>{note ?? `Below is the reviewed design for ${title}. ${listed(MOCK_SCREENS)} are designs; every other screen in the sidebar reads the live API.`}</span>
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto whitespace-nowrap font-medium text-act underline underline-offset-2">
          Open the design ↗
        </a>
      </div>
      <iframe title={`${title} — design`} src={src} className="min-h-0 w-full flex-1 border-0 bg-paper" />
    </div>
  )
}
