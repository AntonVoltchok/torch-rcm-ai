/**
 * E2E for docs/spec/06-demo-script.md.
 *  - default: starts `vite` with VITE_USE_MOCKS=1 (MSW in the browser), no API needed.
 *  - E2E_TARGET=real: expects `make dev` (API :8000 + web :5173) on the canonical seed; run `--grep @demo`.
 */
import { defineConfig, devices } from '@playwright/test'

const real = process.env.E2E_TARGET === 'real'
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: real ? undefined : { command: 'pnpm dev:mocks', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
})
