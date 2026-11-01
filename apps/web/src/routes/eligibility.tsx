import { createFileRoute } from '@tanstack/react-router'
import { eligibilitySearchSchema } from '@/features/eligibility/search'
import { EligibilityPage } from '@/features/eligibility/EligibilityPage'

export const Route = createFileRoute('/eligibility')({ validateSearch: eligibilitySearchSchema, component: EligibilityPage })
