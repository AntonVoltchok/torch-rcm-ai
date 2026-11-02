import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { MoneyMath as Money } from '@/api/schema'
import { MoneyMath } from './MoneyMath'

const base: Money = {
  billed_cents: 124_000,
  allowed_cents: 98_600,
  contractual_cents: 25_400,
  insurance_est_cents: 50_400,
  patient_est_cents: 48_200,
  paid_cents: 0,
  writeoff_cents: null,
  patient_resp_cents: 0,
  basis: 'estimate from contract allowed · Delta Dental PPO',
}
const cell = (label: RegExp) => (screen.getByText(label).closest('div') as HTMLElement)

describe('MoneyMath', () => {
  it('shows the estimate on a denial, where the 835 says the patient owes $0 for now', () => {
    render(<MoneyMath money={base} />)
    expect(within(cell(/^Patient/)).getByText('$482')).toBeInTheDocument()
    expect(cell(/^Patient/)).toHaveTextContent('est.')
    expect(within(cell(/^Contractual/)).getByText('−$254')).toBeInTheDocument()
    expect(within(cell(/^Write-off/)).getByText('—')).toBeInTheDocument()
  })

  it('shows the patient responsibility, unlabelled, once the 835 is final', () => {
    render(<MoneyMath money={{ ...base, paid_cents: 50_400, patient_est_cents: 48_200, patient_resp_cents: 48_200, writeoff_cents: 25_400, basis: 'per 835' }} />)
    expect(within(cell(/^Patient/)).getByText('$482')).toBeInTheDocument()
    expect(cell(/^Patient/)).not.toHaveTextContent('est.')
    expect(within(cell(/^Write-off/)).getByText('−$254')).toBeInTheDocument()
  })

  it('does not read a zero contractual as negative', () => {
    render(<MoneyMath money={{ ...base, contractual_cents: 0 }} />)
    expect(within(cell(/^Contractual/)).getByText('$0')).toBeInTheDocument()
  })
})
