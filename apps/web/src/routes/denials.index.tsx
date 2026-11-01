import { createFileRoute } from '@tanstack/react-router'
import { DenialsPage } from '@/features/static/pages'

export const Route = createFileRoute('/denials/')({ component: DenialsPage })
