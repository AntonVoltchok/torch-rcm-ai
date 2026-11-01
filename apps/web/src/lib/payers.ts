/** Display names for the closed PayerKey / AgentKind enums. Constants of the domain, not server data. */
import type { AgentKind, PayerKey } from '@/api/schema'

export const PAYER_NAME: Record<PayerKey, string> = {
  delta_ny: 'Delta Dental',
  metlife: 'MetLife',
  cigna: 'Cigna',
  aetna: 'Aetna',
  guardian: 'Guardian',
  ny_medicaid: 'NY Medicaid',
}

export const AGENT_NAME: Record<AgentKind, string> = {
  eligibility: 'Eligibility',
  claims: 'Claims',
  followup: 'Follow-up',
  appeals: 'Appeals',
  posting: 'Posting',
}

export const AGENT_COUNT = Object.keys(AGENT_NAME).length
