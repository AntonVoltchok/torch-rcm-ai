// Regenerates Zod schemas from the API's OpenAPI snapshot (apps/api/openapi.snapshot.json → src/api/generated.ts).
// src/api/schema.ts names them for the app. Objects are generated strict: an unknown key fails the parse instead of
// rendering empty.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const snapshot = resolve(here, '../../api/openapi.snapshot.json')
const out = resolve(here, '../src/api/generated.ts')

if (!existsSync(snapshot)) {
  console.error(`gen:api: ${snapshot} not found. Run \`make gen-api\` from the repo root, or \`torch openapi\` in apps/api.`)
  process.exit(1)
}
const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('openapi-zod-client/package.json'))
const template = join(pkgDir, 'src/templates/schemas-only.hbs')
execFileSync(
  'pnpm',
  ['exec', 'openapi-zod-client', snapshot, '-o', out, '-t', template, '--export-schemas', '--export-types', '--strict-objects'],
  { stdio: 'inherit' },
)
execFileSync('pnpm', ['exec', 'prettier', '--write', out], { stdio: 'inherit' })
console.log(`gen:api: wrote ${out}. Run pnpm typecheck.`)
