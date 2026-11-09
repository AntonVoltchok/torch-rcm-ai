import { createFileRoute } from '@tanstack/react-router'
import { MockOnlyBanner } from '@/components/MockOnlyBanner'
import { PageHeader } from '@/components/PageHeader'

function AppealWorkbench() {
  const { claimId } = Route.useParams()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Formal appeal workbench" sub={claimId} />
      <MockOnlyBanner
        title="The formal appeal workbench"
        anchor="r6-s2"
        note="A formal appeal attests clinical facts and the rendering dentist signs it; the workbench is shown as the reviewed design."
      />
    </div>
  )
}

export const Route = createFileRoute('/denials/$claimId')({ component: AppealWorkbench })
