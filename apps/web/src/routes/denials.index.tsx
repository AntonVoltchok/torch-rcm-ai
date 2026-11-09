import { createFileRoute } from '@tanstack/react-router'
import { denialsSearchSchema } from '@/features/denials/search'
import { DenialsPage } from '@/features/denials/DenialsPage'

export const Route = createFileRoute('/denials/')({
  validateSearch: denialsSearchSchema,
  staticData: { chrome: { panel: false } },
  component: DenialsPage,
})
