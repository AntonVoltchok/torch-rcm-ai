import { createFileRoute } from '@tanstack/react-router'
import { MockOnlyBanner } from '@/components/MockOnlyBanner'
import { PageHeader } from '@/components/PageHeader'

export const Route = createFileRoute('/patients')({
  component: () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Patients" sub="checkout estimate, balances, statements" />
      <MockOnlyBanner title="Patient balances and the checkout estimate" anchor="r7-s2" />
    </div>
  ),
})
