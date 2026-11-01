import { createFileRoute } from '@tanstack/react-router'
import { MockOnlyBanner } from '@/components/MockOnlyBanner'
import { PageHeader } from '@/components/PageHeader'

export const Route = createFileRoute('/payments')({
  component: () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Payments" sub="835 posting, held lines and variances" />
      <MockOnlyBanner title="ERA posting" anchor="r3-pay" />
    </div>
  ),
})
