// Regenerates Zod schemas from the API's OpenAPI snapshot (apps/api/openapi.snapshot.json → src/api/generated.ts).
// src/api/schema.ts names them for the app. Objects are generated strict: an unknown key fails the parse instead of
// rendering empty. `pnpm check:api` regenerates and fails if the committed file differs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
execFileSync('pnpm', ['exec', 'openapi-zod-client', snapshot, '-o', out, '-t', template, '--export-schemas', '--export-types', '--strict-objects'], { stdio: 'inherit' })
// openapi-zod-client drops `.int()` inside a union, so `cents: int | None` would accept a float. Money is integer cents.
const generated = readFileSync(out, 'utf8')
writeFileSync(out, generated.replace(/(_cents: z\.union\(\[z\.number\(\))(, z\.null\(\)\]\))/g, '$1.int()$2'))
execFileSync('pnpm', ['exec', 'prettier', '--write', out], { stdio: 'inherit' })
console.log(`gen:api: wrote ${out}. Run pnpm typecheck.`)
