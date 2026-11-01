import type { ClaimStatus } from '@/api/schema'
import { STATUS_LABEL } from '@/lib/strip'
import { Chip, type ChipTone } from './Chip'

const TONE: Record<ClaimStatus, ChipTone> = {
  ready: 'neutral',
  sent: 'neutral',
  rejected: 'bad',
  accepted: 'acc',
  pending: 'neutral',
  denied: 'bad',
  partial: 'warn',
  paid: 'ok',
  appealed: 'warn',
}

/** One of the nine statuses. `needs_action` is never a status — see FlagPill. */
export function StatusChip({ status }: { status: ClaimStatus }) {
  return <Chip tone={TONE[status]}>{STATUS_LABEL[status]}</Chip>
}
