import { createFileRoute } from '@tanstack/react-router'
import { DenialsPage } from '@/features/denials/DenialsPage'

export const Route = createFileRoute('/denials/')({ component: DenialsPage })
