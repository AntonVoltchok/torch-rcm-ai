import { createFileRoute } from '@tanstack/react-router'
import { activitySearchSchema } from '@/features/activity/search'
import { ActivityPage } from '@/features/activity/ActivityPage'

export const Route = createFileRoute('/activity')({ validateSearch: activitySearchSchema, component: ActivityPage })
