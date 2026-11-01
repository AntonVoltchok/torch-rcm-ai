# Status

_Updated by whoever ends a session. Newest first._

## 2026-11-01 — S0 contracts + S1 scaffold (coordinator: Fable 5.1)

**Done**
- Design imported: mocks, wireframes, six red-team reports, decisions log (`docs/design/`).
- Contracts: `docs/spec/00–07`; agent architecture red-teamed and revised (ADR-0001).
- Repo plumbing: Makefile, compose, Dockerfiles, Fly/Vercel configs, CI, `.env.example`, `CLAUDE.md`, `docs/SESSIONS.md`.
- S1 workers (api-core, world+seed, agents, web-shell) — see sections below, appended by each worker.

**Next**
- S2: Settings screen + rules API; Today's claims/Activity/Eligibility/Cash/Denials static screens; Playwright demo script; `make eval` in CI.
- S3: empty/error/outage states, keyboard on tables, `dso_4000_claims` perf scenario, README GIF, interviewer review.

**Blocked / decisions pending**
- Pushing from the coordinator's cloud session is refused until the Claude GitHub App is installed on the repo; commits are on local `main` and must be pushed from the owner's machine (or after the app is installed).

### web-shell

**Done** (`apps/web/`, decisions in `docs/plans/web-shell.md`)
- Project: Vite 6 / React 19 / TS strict, TanStack Router (file routes, Zod `validateSearch`, readable query strings), Query v5, Table + Virtual, Tailwind v4 theme from the mocks, ESLint (typescript-eslint + react-hooks + tanstack-query), Prettier, Vitest, Playwright, `nginx.conf` (SPA fallback), `.env.example`, `pnpm gen:api` (no-op until `apps/api/openapi.snapshot.json` exists).
- All routes from 05-frontend: Inbox, Claims, Claim detail are interactive; Today's claims / Activity / Eligibility / Cash / Denials / Settings › Agents are typed read shells; Payments, Patients and the appeal workbench render `MockOnlyBanner` + the design. `/cash` and `/settings/*` are owner-gated in `beforeLoad`, from the same table that builds the nav.
- Shell: live badges from the strip / `meta.counts`, "5 agents · N running" + paused chip (agents status + firehose, degrades to polling), user switcher (`X-Torch-User`), location switcher, owner-only clock skip with async progress.
- Inbox: split pane, URL selection, Delta group with Approve 3, item detail with confidence + basis, evidence cards per kind, tier badge, Approve / Edit / Reject / Snooze, optimistic removal with rollback, 409 `file_departed` → "Corrected claim (tier 2)", "Always auto-run" with the 422 guard reason, ProgressPanel over SSE (progress lines, agent label + rationale, policy verdict, planner, paused chip, audit line, Last-Event-ID resume, polling fallback), keyboard via `useListKeys`.
- Claim detail (money math, lines, attachments, acks, readiness, three-lane timeline, open items with approve, breadcrumb, "Ask Follow-up to look"); Claims table (virtualized, sticky header, server sort/filter in the URL, quick + saved views, age colours, j/k/enter).
- MSW mock layer (`VITE_USE_MOCKS=1`) that reproduces the 10:40 numbers exactly and runs the step 3 / 3b recipes with streamed events.
- Tests: Vitest (search params, formatting, strip selectors, SSE reducer, inbox selectors, mock invariants, ProgressPanel out-of-order SSE, Inbox optimistic approve / rollback / 409 / guard); Playwright `e2e/demo.spec.ts` (@demo) for steps 1–5 + 3b and reload-mid-run.

**Blocked**
- `registry.npmjs.org` is refused by this session's egress policy, so nothing was installed and lint / typecheck / test / build have **not** run. Verified offline: every file parses; all React-free modules typecheck; the 36 pure tests pass through a shim. First run elsewhere: `cd apps/web && pnpm install && pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm build`, then commit `pnpm-lock.yaml` (CI uses `--frozen-lockfile`).

**Next**
- Run the toolchain and fix whatever the first lint/typecheck pass reports in the React/TanStack code.
- Regenerate `src/api/` from the OpenAPI snapshot when api-core publishes it; reconcile the assumptions in `docs/plans/web-shell.md` §2.
- S2: interactive Settings › Agents (PATCH rule, preview, proposals accept); static screens to their mocks; e2e steps 6–10.

### api-core / world / seed

**Done** (`apps/api/` except `torch/agents/`; decisions D1–D18 in `docs/plans/api-core.md`)
- `torch/domain`: enums (revised 01-domain-model incl. `payer_rep_call`, `paused`, AgentMode, PlannerKind), value objects, the entity set (one pydantic model set = OpenAPI schemas = storage), status state machine with tier gates, invariants as pure functions, `routing.route_denial` (CARC·RARC → next action, shared with agents).
- `torch/db/store.py`: SQLite document store with generated, indexed columns, unique idempotency keys, one writer + WAL readers (D13 — replaces SQLModel; see blocker).
- `torch/clock.py` (persisted, forward-only), `torch/world/` (calendar with DST + payer holidays, keyed PRNG, CDT/fee/contract schedules, payer profiles, **adjudication with balanced CARC·RARC lines**, PMS/Vyne/NEA/PayerSim with portal/IVR/rep contact, bounded rep calls, seeded + injected outages, WorldCallLog with idempotent mutations), five scenarios.
- `torch/scheduler/`: durable jobs (idempotent enqueue, leases, retry → dead, park/unpark, recover), `Registry` for torch.agents, world handlers (files, Vyne/payer acks, in-process, 835s, checkouts, hold aging, snooze wake), `run_due(until)` + async advance (202, progress on the firehose, 409), background worker.
- `torch/seed/`: canonical practice — pinned records per 04-seed, generated remainder fitted exactly (IPF + composable repair), patient ledger, 19 rules / 5 changes / 3 proposals, 53 decisions this week, 12 open items with evidence + world-call provenance, appointments, estimates, initial job schedule. Builds in ~0.6 s.
- `torch/readmodels/` + `torch/api/`: strip, inbox (priority, groups), claims query (filter/sort/cursor), claim detail + merged timeline, ledger, activity, eligibility + benefits panel, cash KPIs with formulas, denials by next action, remittances, patient balances, preview; services for every endpoint in 02-api (+ `?wait=true` on advance); FastAPI routers, SSE (replay stored steps / `run_events`), error envelope, `meta.counts`; `torch/api/contract.py` route table; typer CLI (`seed`, `openapi`, `advance`, `eval`).
- `apps/api/openapi.snapshot.json`: 47 paths, 144 schemas (from the contract table; FastAPI regenerates the same where installed).
- Tests: **94 passed, 2 skipped** here (`python3 -m pytest -q`): every 04-seed reconciled number, invariants after seed / Thu 07:10 / Fri 07:10, demo step 8 (11:15 file, A1s, overnight 835s Ito CO-50·N10 / Moreno CO-22 / Morris CO-29 / Castillo CO-16·M127, Denied → 9, six paid), scheduler ordering/barrier/retries/leases/async 409, world outages/idempotency/rejects/rep bounds, 3,000-claim balance sweep, every service flow (approve/group/409/403/422, owner sign-off, preview, proposals, void/corrected/triage, pause), scenarios, no wall-clock reads. Skipped: HTTP contract tests (need FastAPI) and the hypothesis property test.

**Blocked**
- PyPI is refused by this session's egress policy (403), so FastAPI, typer, structlog, pydantic-settings, hypothesis were not installable: `uv sync` / `uv run …` have **not** run and there is no `uv.lock`. Lint (`ruff check`, `ruff format --check`) is clean on my packages; mypy is clean except "untyped decorator" errors that exist only because FastAPI/typer are missing. Not yet executed: routers, SSE, app lifespan, CLI, `tests/test_api_contract.py`. Run `docs/FIRST_RUN.md`.

**Next**
- First run with packages: `uv sync && uv run ruff check . && uv run mypy torch && uv run pytest -q`, `uv run torch openapi --out openapi.snapshot.json` (FastAPI's document), commit `uv.lock`.
- Coordinator: adapters from `torch/agents/ports.py` onto `torch.world` / `torch.scheduler.registry` / the store (interface in `docs/plans/api-core.md` §2); decide the demo step 6 preview numbers (§3); spec edits for D15/D16/D17.
