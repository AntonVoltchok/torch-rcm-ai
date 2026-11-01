import { createFileRoute } from '@tanstack/react-router'
import { LedgerPage } from '@/features/static/pages'

export const Route = createFileRoute('/ledger')({ component: LedgerPage })
