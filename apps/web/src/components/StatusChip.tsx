import type { ClaimStatus } from '@/api/schema'
import { STATUS_LABEL } from '@/lib/strip'
import { Chip, type ChipTone } from './Chip'

const TONE: Record<ClaimStatus, ChipTone> = {
  ready: 'neutral',
  sent: 'neutral',
  rejected: 'risk',
  accepted: 'neutral',
  pending: 'neutral',
  denied: 'risk',
  partial: 'neutral',
  paid: 'ok',
  appealed: 'neutral',
}

/** One of the nine statuses. D1: status is not whose move, so only denied/rejected (red) and paid (green) carry hue. `needs_action` is never a status — see FlagPill. */
export function StatusChip({ status }: { status: ClaimStatus }) {
  return <Chip tone={TONE[status]}>{STATUS_LABEL[status]}</Chip>
}
