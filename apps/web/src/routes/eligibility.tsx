import { createFileRoute } from '@tanstack/react-router'
import { eligibilitySearchSchema } from '@/features/static/search'
import { EligibilityPage } from '@/features/static/pages'

export const Route = createFileRoute('/eligibility')({ validateSearch: eligibilitySearchSchema, component: EligibilityPage })
