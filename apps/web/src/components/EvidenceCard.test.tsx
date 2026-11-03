import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/schema'
import { EvidenceCard } from './EvidenceCard'

const base: Evidence = {
  id: 'ev_1',
  kind: 'pms_record',
  title: 'PA x-ray, tooth #14',
  excerpt: 'Periapical of #14 taken 10/19, signed by Dr. Morgan.',
  captured_at: '2026-10-28T06:14:00-04:00',
  reference: 'img_diaz_f_1019_pa_14',
  suspicious: false,
  source: 'pms',
}

describe('EvidenceCard', () => {
  it('shows the captured words, never a drawn stand-in', () => {
    const { container } = render(<EvidenceCard evidence={base} />)
    expect(screen.getByText(/Periapical of #14 taken 10\/19/)).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden], img, svg')).toBeNull()
  })

  it('hides internal ids and keeps references a person can use', () => {
    const { rerender } = render(<EvidenceCard evidence={base} />)
    expect(screen.queryByText(/img_diaz/)).toBeNull()
    rerender(<EvidenceCard evidence={{ ...base, reference: 'DD-1027-88412' }} />)
    expect(screen.getByText(/DD-1027-88412/)).toBeInTheDocument()
  })
})
