import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ClaimDetail, ClaimLine } from '@/api/schema'
import { DenialCard, LinesTable } from './ClaimSections'

// #4772 as the 835 has it: the line paid, PR-1 applied though the deductible was met.
const line: ClaimLine = {
  id: 'cl_4772_1',
  cdt: 'D2392',
  tooth: '19',
  surface: 'MO',
  fee_cents: 25500,
  allowed_cents: 16800,
  paid_cents: 10880,
  adj: [{ group: 'CO', code: '45', cents: 8700 }],
  patient_adj: [
    { group: 'PR', code: '1', cents: 3200 },
    { group: 'PR', code: '2', cents: 2720 },
  ],
  patient_cents: 5920,
}

const detail = (status: 'partial' | 'denied', lines: ClaimLine[]) =>
  ({
    claim: { status, reason: 'underpaid $25.60 · PR-1 though deductible met 05/12' },
    denial: { carc: 'PR-1', rarc: null, decoded: 'Deductible', root_cause: 'payer' },
    lines,
    timeline: [],
    deadline: { kind: null, due_on: null, basis: null },
  }) as unknown as ClaimDetail

describe('claim sections', () => {
  it('lists the patient adjustments beside the contractual one', () => {
    render(<LinesTable lines={[line]} estimate={false} />)
    expect(screen.getByText('CO-45 $87, PR-1 $32, PR-2 $27.20')).toBeInTheDocument()
  })

  it('calls a partial payment where every line paid underpaid, not denied, in the server’s words', () => {
    render(<DenialCard d={detail('partial', [line])} />)
    expect(screen.getByRole('region', { name: 'Underpaid' })).toHaveTextContent('Underpaid PR-1')
    expect(screen.getByText('Underpaid $25.60 · PR-1 though deductible met 05/12.')).toBeInTheDocument()
    expect(screen.queryByText(/Denied/)).toBeNull()
  })

  it('keeps "Denied" when a line paid nothing', () => {
    render(<DenialCard d={detail('partial', [line, { ...line, id: 'cl_2', paid_cents: 0 }])} />)
    expect(screen.getByRole('region', { name: 'Denial' })).toHaveTextContent('Denied PR-1')
  })
})
