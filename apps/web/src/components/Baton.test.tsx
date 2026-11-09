import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { HolderCount } from '@/api/schema'
import { Baton, batonProps } from './Baton'
import { HolderTally, holderSentence } from './HolderTally'

const rod = (c: HTMLElement) => c.querySelector<HTMLElement>('.baton-rod')

describe('Baton', () => {
  it('puts the rod at the holder’s stop, in its shape', () => {
    const { container, rerender } = render(<Baton who="practice" />)
    expect(rod(container)?.style.getPropertyValue('--p')).toBe('0')
    expect(rod(container)).toHaveClass('party-shape-practice')
    rerender(<Baton who="payer" />)
    expect(rod(container)?.style.getPropertyValue('--p')).toBe('2')
    expect(rod(container)).toHaveClass('party-shape-payer')
  })

  it('draws the empty track for nobody', () => {
    const { container } = render(<Baton who="nobody" />)
    expect(rod(container)).toBeNull()
    expect(screen.getByRole('img', { name: 'Nobody holds this now' })).toBeInTheDocument()
  })

  it('names the holder and the next stop; the server’s label wins', () => {
    render(<Baton who="practice" next="agents" />)
    expect(screen.getByRole('img', { name: 'With you, next the agents' })).toBeInTheDocument()
    render(<Baton {...batonProps({ who: 'practice', holder_role: 'owner', holder_user_id: 'usr_morgan', mine: false, label: 'Dr. Morgan signs' })} />)
    expect(screen.getByRole('img', { name: 'Dr. Morgan signs' })).toBeInTheDocument()
  })

  it('hatches a practice rod someone else holds, and hides a decorative one', () => {
    const { container } = render(<Baton who="practice" held="other" decorative />)
    expect(rod(container)).toHaveAttribute('data-held', 'other')
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('HolderTally', () => {
  const rows: HolderCount[] = [
    { who: 'agents', holder_role: null, holder_user_id: null, mine: false, count: 2 },
    { who: 'practice', holder_role: 'billing', holder_user_id: 'usr_dana', mine: true, count: 3 },
  ]

  it('draws one tick per claim, practice first', () => {
    const { container } = render(<HolderTally rows={rows} />)
    const ticks = [...container.querySelectorAll('.party-tick')]
    expect(ticks).toHaveLength(5)
    expect(ticks[0]).toHaveClass('party-shape-practice')
    expect(ticks[4]).toHaveClass('party-shape-agents')
  })

  it('says it in words, naming a practice holder who is not the viewer', () => {
    expect(holderSentence(rows)).toBe('2 with the agents, 3 with you')
    expect(holderSentence([{ who: 'practice', holder_role: 'owner', holder_user_id: 'usr_morgan', mine: false, count: 1 }])).toBe('1 with Dr. Morgan')
  })
})
