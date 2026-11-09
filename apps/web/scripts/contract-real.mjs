// `pnpm test:contract`: holds src/api/schema.ts to the real API, not the mock. Dumps real responses and SSE frames from
// the API in-process (scripts/contract_dump.py, no port bound), then runs src/api/real.contract.ts over the dump.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dump = mkdtempSync(join(tmpdir(), 'torch-contract-'))
try {
  execFileSync('uv', ['run', 'python', join(here, 'contract_dump.py'), dump], { cwd: resolve(here, '../../api'), stdio: 'inherit' })
  execFileSync('pnpm', ['exec', 'vitest', 'run'], { cwd: resolve(here, '..'), stdio: 'inherit', env: { ...process.env, CONTRACT_DUMP: dump } })
} finally {
  rmSync(dump, { recursive: true, force: true })
}
