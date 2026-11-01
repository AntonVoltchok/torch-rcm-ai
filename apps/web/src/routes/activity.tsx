import { createFileRoute } from '@tanstack/react-router'
import { activitySearchSchema } from '@/features/static/search'
import { ActivityPage } from '@/features/static/pages'

export const Route = createFileRoute('/activity')({ validateSearch: activitySearchSchema, component: ActivityPage })
