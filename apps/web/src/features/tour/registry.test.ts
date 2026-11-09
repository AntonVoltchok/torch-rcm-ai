import { describe, expect, it } from 'vitest'
import { NAV } from '@/features/shell/nav'
import { USERS } from '@/state/session'
import { hasPayload, PAYLOADS } from './payloads'
import { SCREEN_TOURS, TOURS } from './registry'
import { NAV_TOUR, tourForPath, toursFor } from './screens'

describe('tour registry', () => {
  it('has a tour for every screen in the sidebar, and every screen tour is listed', () => {
    for (const n of NAV) expect(TOURS[NAV_TOUR[n.to]], n.to).toBeDefined()
    expect(new Set(SCREEN_TOURS)).toEqual(new Set([...Object.values(NAV_TOUR), 'claim']))
  })

  it('maps routes to tours: claim detail has its own, the appeal workbench has none', () => {
    expect(tourForPath('/inbox')).toBe('inbox')
    expect(tourForPath('/settings/agents')).toBe('settings')
    expect(tourForPath('/claims')).toBe('claims')
    expect(tourForPath('/claims/clm_4821')).toBe('claim')
    expect(tourForPath('/denials')).toBe('denials')
    expect(tourForPath('/denials/clm_4796')).toBeNull()
  })

  it('offers each role only the tours of screens its sidebar shows', () => {
    const dana = toursFor('billing')
    expect(dana).not.toContain('cash')
    expect(toursFor('owner')).toContain('cash')
    expect(dana.indexOf('claim')).toBe(dana.indexOf('claims') + 1)
    for (const u of USERS) expect(toursFor(u.role).length).toBeGreaterThan(0)
  })

  it('opens the main tour with the welcome and ends it with the finish modal', () => {
    const steps = TOURS.main.steps
    expect(steps[0]?.modal).toBe('welcome')
    expect(steps.at(-1)?.modal).toBe('finish')
  })

  it('gives every spotlight step an anchor and a unique id', () => {
    for (const t of Object.values(TOURS)) {
      expect(new Set(t.steps.map((s) => s.id)).size, t.id).toBe(t.steps.length)
      for (const s of t.steps) if (!s.modal) expect(s.anchor, `${t.id}/${s.id}`).toBeTruthy()
    }
  })

  it('points every static pane at a generated payload that exists', () => {
    for (const name of PAYLOADS) expect(hasPayload(name), name).toBe(true)
    for (const t of Object.values(TOURS))
      for (const s of t.steps) for (const c of s.code ?? []) if (c.load.type === 'static') expect(PAYLOADS, `${t.id}/${s.id}`).toContain(c.load.name)
  })

  it('labels every #4744 cassette pane as a recorded API response', () => {
    const panes = Object.values(TOURS).flatMap((t) => t.steps.flatMap((s) => s.code ?? []))
    const plan = panes.filter((c) => c.load.type === 'static' && c.load.name === 'plan_4744')
    expect(plan.length).toBeGreaterThan(0)
    for (const c of plan) expect(c.kind).toBe('recording')
  })
})
