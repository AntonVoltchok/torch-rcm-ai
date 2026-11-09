# First run on a machine with package-registry access

_Done 2026-11-02: see `docs/STATUS.md` and `docs/adr/worker-notes/first-run.md`. Lockfiles are committed. On a new machine install `uv`, then `make dev`. Kept for the history of what the first pass expected._

The scaffold was written in a cloud session whose network allowed GitHub but **not** PyPI or the npm registry, so nothing was installed and the toolchain (ruff, mypy, pytest, eslint, tsc, vitest, playwright) has not run. The code was checked with what was available (parsing, stdlib-only tests, pure-module typechecks), and the authors flagged where to expect first-run fixes. Do this once, on your laptop, in Claude Code:

```bash
git clone https://github.com/AntonVoltchok/torch-rcm-ai && cd torch-rcm-ai
cp .env.example .env

# API
cd apps/api && uv sync && uv run ruff check . && uv run mypy torch_rcm && uv run pytest -q
uv run torch seed --force && uv run torch openapi --out openapi.snapshot.json

# Web
cd ../web && pnpm install && pnpm gen:api && pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm build
cd ../.. && git add apps/web/pnpm-lock.yaml apps/api/uv.lock apps/api/openapi.snapshot.json && git commit -m "chore: lockfiles + openapi snapshot from first run"

make dev     # http://localhost:5173 — Inbox should show 12 items
make e2e     # Playwright demo script
make eval    # deterministic + cassette replay must agree
```

## Prompt to paste into Claude Code for the first-run fix pass

> Read CLAUDE.md and docs/STATUS.md. Run the commands in docs/FIRST_RUN.md. Fix every lint, type, test and build failure without changing any contract in docs/spec (if a contract must change, write docs/plans/<topic>.md and an ADR). Reconcile the web client with the generated OpenAPI snapshot (`pnpm gen:api`) and remove the hand-written Zod mirror where the generated one covers it. Then run the demo script in docs/spec/06-demo-script.md by hand against `make dev` and fix what doesn't match. Append to docs/STATUS.md. Do not ask me questions; for judgment calls use the red-team procedure in docs/SESSIONS.md.

## Known first-run risks (from the workers' reports)

- `apps/web`: React/TanStack components, hooks, routes and the two React test files were written against the APIs but never compiled; expect a handful of type fixes. `public/mockServiceWorker.js` is generated on `pnpm install` (msw `workerDirectory`). ESLint is set to `recommendedTypeChecked`; tighten to `strictTypeChecked` once green.
- `apps/api`: see the `### api-core / world / seed` and `### agents` sections in `docs/STATUS.md` for what each author could and could not execute.
- Cassettes under `apps/api/cassettes/canonical/` are hand-authored (`synthetic: true`). With `ANTHROPIC_API_KEY` set, run `cd apps/api && uv run torch cassette record --scenario canonical` to replace them with real recordings, then `make eval`.
