/**
 * Helpers shared by the demo story (e2e/demo.spec.ts) and the standalone demo specs. Owner: the coordinator.
 * MSW by default; E2E_TARGET=real drives the real API at E2E_API_BASE (after `make seed`).
 */
import type { Page } from '@playwright/test'

export const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8000/api/v1'

export const real = process.env.E2E_TARGET === 'real'

export async function switchUser(page: Page, id: 'usr_dana' | 'usr_morgan') {
  await page.getByLabel('Switch user').selectOption(id)
}

export const nav = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })

export async function freshDemo(page: Page) {
  if (real) {
    await page.request.post(`${API_BASE}/clock/reset`, { headers: { 'X-Torch-User': 'usr_morgan' } })
  }
  await page.goto('/inbox')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
    // The onboarding tours open on their own; the demo specs drive the app, not the tour (e2e/tour.spec.ts does).
    localStorage.setItem('torchrcm.tour.autoopen', 'false')
  })
  await page.goto('/inbox')
}
