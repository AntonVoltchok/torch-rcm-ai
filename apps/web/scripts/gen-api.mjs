// Regenerates Zod schemas from the API's OpenAPI snapshot (apps/api/openapi.snapshot.json → src/api/generated.ts).
// Needs registry access (openapi-zod-client, prettier). Until it has run, src/api/schema.ts is the hand-maintained
// mirror of the snapshot; afterwards schema.ts should re-export from ./generated.ts. Objects are generated strict,
// like the mirror: an unknown key fails the parse instead of rendering empty.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const snapshot = resolve(here, '../../api/openapi.snapshot.json')
const out = resolve(here, '../src/api/generated.ts')

if (!existsSync(snapshot)) {
  console.log(`gen:api: ${snapshot} not found — keeping the hand-written src/api/schema.ts.`)
  process.exit(0)
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
console.log(`gen:api: wrote ${out}. Re-point src/api/schema.ts exports at it and run pnpm typecheck.`)
