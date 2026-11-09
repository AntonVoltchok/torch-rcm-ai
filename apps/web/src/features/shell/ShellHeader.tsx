import { useMatch } from '@tanstack/react-router'
import { useStrip } from '@/hooks/useStrip'
import { PipelineStrip } from '@/components/PipelineStrip'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import type { Chrome } from './chrome'
import { WhoseMoveCards } from './WhoseMoveCards'

/**
 * The top of every screen, chosen by the route's `chrome.header`. `full`: the three whose-move cards beside the
 * to-scale pipeline card (D1's Inbox). `slim`: the pipeline as one line. On /claims with one status filter, that
 * stage shows as current; the status comes from the validated URL, not from props.
 */
export function ShellHeader({ header }: { header: Chrome['header'] }) {
  const claims = useMatch({ from: '/claims/', shouldThrow: false })
  const active = claims?.search.status
  if (header === 'none') return null
  if (header === 'slim') return <PipelineStrip variant="line" active={active} />
  return (
    <div className="grid flex-none grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 px-4 pb-3 pt-3.5">
      <FullCards />
      <PipelineStrip variant="card" active={active} />
    </div>
  )
}

function FullCards() {
  const strip = useStrip()
  if (strip.data) return <WhoseMoveCards strip={strip.data} />
  if (strip.isError) {
    return (
      <div className="panel flex items-center px-4 text-sm text-mid">Whose move: counts unavailable. The pipeline beside this has a retry.</div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <SkeletonBlock key={i} className="h-[108px] rounded-panel" />
      ))}
    </div>
  )
}
