# Status

_Updated by whoever ends a session. Newest first._

## 2026-11-02 — TorchRCM rename and round 2 of the redesign (Opus 5.5)

**State:** committed on `chore/first-run`, not pushed. The owner picked variation D and asked for two restyles. The product is now **TorchRCM** in everything people see. Identifiers, model prompts and tool schemas keep the old word, because cassettes depend on them.

- Round 2: https://claude.ai/artifact/FrNNQtYKNHQcBxhF7JSDUK (private), source in `docs/design/variations/round-2/`. D1 is a dashboard layout. D2 is D with new colors and type only: its render code is byte-identical to D. Original is freshly shot from the app, with the fixes and the new name.
- Checks: `make lint`, `make test` (560 API + 109 web), `make eval`, `pnpm test:contract` (51 of 51), both e2e suites (3 of 3 each, on throwaway stacks).
- `docs/spec/00-product.md`, `06` and `07` carry the new name. `CLAUDE.md` and the other docs still say Torch.

**Waiting on the owner:** which style to take forward, and whether D goes into the app.


## 2026-11-02 — UX audit and round 1 design variations (Opus 5.5)

**State:** audit, red team and five clickable variations are done, and the truth fixes are in (A9, T1 to T7, ADR-0007). T8 turned out not to be a defect. Committed on `chore/first-run`, not pushed.

| Check | Result |
|---|---|
| `make lint` | clean |
| `make test` | 560 API + 109 web |
| `make eval` | OK |
| `pnpm build` | clean |
| `pnpm check:api` | clean |
| `pnpm test:contract` | 51 of 51 |
| `pnpm e2e` (MSW) | 3 of 3 |
| `E2E_TARGET=real pnpm e2e --grep @demo` | 3 of 3 on a throwaway API and database |

- Audit: `docs/design/ux-audit-2026-11-02.md`, red-teamed in `docs/design/red-team/challenge-ux-audit-2026-11-02.md`. The post-click path was watched on a throwaway stack.
- Variations: https://claude.ai/artifact/JBZW67Fde6GsFxZgjYY7qq (private), source in `docs/design/variations/round-1/`. Owner feedback lands in the artifact's `feedback` collection.
- `E2E_API_BASE` lets the real-stack demo run beside a live `make dev`; without it, the demo resets the API on :8000.

**Waiting on the owner:** picks and tags from the artifact; whether to cut the demo script to steps 1, 2, 3, 4, 6, 8.

**Next, whichever variation wins**
- R1, R2: the run panel hides its steps and arms the next item under a running job.
- A6: "Always auto-run" is offered, then refused, on root-cause-ours items.
- Whose move must become a server-derived field. The prototype derives it from status.
- D7, D12: raw ids on Activity; Appeals vs Follow-up on #4733.

**Not proven:** Prototype approvals are simulated, and #4851's failure is staged: the real app approved it during the Cigna outage. `stopped_by` for a run-created item was seen on triage; the demo e2e covers Thursday's items but does not assert their wording.


## 2026-11-02 — First real run: green against the real API (coordinator: Opus 5.5)

**State:** the toolchain ran for the first time, on the owner's laptop. Everything below passed on the final code, on branch `chore/first-run`. Nothing is pushed or merged to `main`.

| Check | Result |
|---|---|
| `make lint` | clean (ruff, mypy strict on `domain` and `agents`, eslint, tsc) |
| `make test` | 556 API + 103 web, 0 skipped; web also on Node 22 (CI) and 24 (laptop) |
| `make eval` | OK in deterministic and cassette modes |
| `E2E_TARGET=real pnpm e2e --grep @demo` | 3 of 3 against the real API |
| `pnpm e2e` (MSW) | 3 of 3 (stop `make dev` first, or it attaches to the real stack) |
| `pnpm test:contract` | 51 of 51 against the real API |
| `pnpm check:api`, `pnpm build` | clean |
| By hand | Demo steps 1–8 in the browser against the real API; Activity and Denials read on Thursday; Cash only through e2e |
| `kill -9` the API mid-run, restart | resumed at step 3 of 8, finished, one NEA upload |

**Decisions:** ADR-0004 (one async advance path), ADR-0005 (web follows the generated contract), ADR-0006 (first-run hardening). Red-team reports are in `docs/design/red-team/`, dated 2026-11-02. Spec edits: 02 (reset refusals, `signoff_stale`), 05 (outage banner, `meta.counts`), 06 (the group opens on #4840, days in A/R 26 on Thursday, an advance takes about 20 s), 07 (Observe rows).

**Real bugs found** (the tests were green for most of them)
- Agent runs: the stream closed before `counts` and `done`, so nothing refreshed after a run; run steps carrying evidence were dropped; the firehose listened for an event the API never sends.
- Authority: billing could sign a tier-2 rule by replaying an approval; the tier-3 role check had the same hole.
- Trust: a sign-off request vanished under an Idempotency-Key, so Dana saw "Sent to Dr. Morgan" and nothing was sent; a repeat returned 500.
- Observe: an observe rule could still open an item and contact a payer.
- Clock and restart: the clock could move under a running approval; a reset during a run killed the worker for good; a restarted API reused call ids; a restart mid-advance left every later advance at 409.
- Consistency: Castillo read "ours" in the Inbox and "theirs" on Denials; a 10/12 timeline entry listed an attachment made on 10/28; visits finished after their claims were built.

**Not proven**
- **Live mode has never called the real API.** No `ANTHROPIC_API_KEY` on this machine, so step 4 of the session was skipped: cassettes are still `synthetic: true`, and `make eval` compares shapes against hand-authored cassettes. Castillo and Moreno replay as `scripted_fallback`.
- **CI has never run on GitHub.** `act` ran it locally in part; the new `contract` job was run only as local commands.
- **CI has no e2e step**, so the real-API demo script is a local check.
- `docker compose up` was not tried.
- `file_departed` is asserted only against the mock: the canonical seed has no open hold-window item with a queued file.

**Known and accepted** (ADR-0006)
- Under an observe rule, an `unknown` case reaches nobody, only a row in Activity. A partial Observe thins a run's evidence.
- An Observe run can find `ours` while Denials shows `payer`: fixing it would need a write under Observe.
- Mock Thursday A/R reads $73,220 where the API reads $70,869. Both give 26 days; only a basis line differs between modes.

**Next**
1. Set `ANTHROPIC_API_KEY`, then `cd apps/api && uv run torch cassette record --scenario canonical` and `make eval`. Expect first-contact work: live mode has never run.
2. Push, and watch the first CI run.
3. API, recorded not done: make OpenAPI true for error responses and `default_factory` fields (`errors=` already exists in the route table); handlers for `visit.checked_out` and `eligibility.sweep`.
4. Web: tighten ESLint to `strictTypeChecked`. Splitting `make lint` into `lint-api` and `lint-web` would let CI call make targets.
5. Rehearse the onsite: `docs/WALKTHROUGH.md`, and the ten questions in the repo-review report.

The sections below are the history of the first build pass. Where they disagree with this one, this one is right; `?wait=true` on advance, for one, is gone (ADR-0004).

## 2026-11-01 — End of first build pass (coordinator: Fable 5.1)

**State:** API 391 pure tests + eval green; web written and reviewed, never compiled (no registry access). Repo review red team + fix pass applied. Read `docs/WALKTHROUGH.md`, then `docs/FIRST_RUN.md`.

**Next session (on a laptop, hands-on):** run `docs/FIRST_RUN.md`; expect 20–35 h to green `make lint test e2e eval` against the real API; regenerate the web client (`make gen-api`); record real cassettes with a key; rehearse the ten onsite questions in the repo-review report.

**Blocked:** pushing from the build session (no GitHub App access); commits are on local `main` — see the hand-off note.

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

**Done** (`apps/api/` except `torch_rcm/agents/`; decisions D1–D18 in `docs/plans/api-core.md`)
- `torch_rcm/domain`: enums (revised 01-domain-model incl. `payer_rep_call`, `paused`, AgentMode, PlannerKind), value objects, the entity set (one pydantic model set = OpenAPI schemas = storage), status state machine with tier gates, invariants as pure functions, `routing.route_denial` (CARC·RARC → next action, shared with agents).
- `torch_rcm/db/store.py`: SQLite document store with generated, indexed columns, unique idempotency keys, one writer + WAL readers (D13 — replaces SQLModel; see blocker).
- `torch_rcm/clock.py` (persisted, forward-only), `torch_rcm/world/` (calendar with DST + payer holidays, keyed PRNG, CDT/fee/contract schedules, payer profiles, **adjudication with balanced CARC·RARC lines**, PMS/Vyne/NEA/PayerSim with portal/IVR/rep contact, bounded rep calls, seeded + injected outages, WorldCallLog with idempotent mutations), five scenarios.
- `torch_rcm/scheduler/`: durable jobs (idempotent enqueue, leases, retry → dead, park/unpark, recover), `Registry` for torch_rcm.agents, world handlers (files, Vyne/payer acks, in-process, 835s, checkouts, hold aging, snooze wake), `run_due(until)` + async advance (202, progress on the firehose, 409), background worker.
- `torch_rcm/seed/`: canonical practice — pinned records per 04-seed, generated remainder fitted exactly (IPF + composable repair), patient ledger, 19 rules / 5 changes / 3 proposals, 53 decisions this week, 12 open items with evidence + world-call provenance, appointments, estimates, initial job schedule. Builds in ~0.6 s.
- `torch_rcm/readmodels/` + `torch_rcm/api/`: strip, inbox (priority, groups), claims query (filter/sort/cursor), claim detail + merged timeline, ledger, activity, eligibility + benefits panel, cash KPIs with formulas, denials by next action, remittances, patient balances, preview; services for every endpoint in 02-api (+ `?wait=true` on advance); FastAPI routers, SSE (replay stored steps / `run_events`), error envelope, `meta.counts`; `torch_rcm/api/contract.py` route table; typer CLI (`seed`, `openapi`, `advance`, `eval`).
- `apps/api/openapi.snapshot.json`: 47 paths, 144 schemas (from the contract table; FastAPI regenerates the same where installed).
- Tests: **94 passed, 2 skipped** here (`python3 -m pytest -q`): every 04-seed reconciled number, invariants after seed / Thu 07:10 / Fri 07:10, demo step 8 (11:15 file, A1s, overnight 835s Ito CO-50·N10 / Moreno CO-22 / Morris CO-29 / Castillo CO-16·M127, Denied → 9, six paid), scheduler ordering/barrier/retries/leases/async 409, world outages/idempotency/rejects/rep bounds, 3,000-claim balance sweep, every service flow (approve/group/409/403/422, owner sign-off, preview, proposals, void/corrected/triage, pause), scenarios, no wall-clock reads. Skipped: HTTP contract tests (need FastAPI) and the hypothesis property test.

**Blocked**
- PyPI is refused by this session's egress policy (403), so FastAPI, typer, structlog, pydantic-settings, hypothesis were not installable: `uv sync` / `uv run …` have **not** run and there is no `uv.lock`. Lint (`ruff check`, `ruff format --check`) is clean on my packages; mypy is clean except "untyped decorator" errors that exist only because FastAPI/typer are missing. Not yet executed: routers, SSE, app lifespan, CLI, `tests/test_api_contract.py`. Run `docs/FIRST_RUN.md`.

**Next**
- First run with packages: `uv sync && uv run ruff check . && uv run mypy torch_rcm && uv run pytest -q`, `uv run torch openapi --out openapi.snapshot.json` (FastAPI's document), commit `uv.lock`.
- Coordinator: adapters from `torch_rcm/agents/ports.py` onto `torch_rcm.world` / `torch_rcm.scheduler.registry` / the store (interface in `docs/plans/api-core.md` §2); decide the demo step 6 preview numbers (§3); spec edits for D15/D16/D17.

### web-s2

**Done** (`apps/web/`, decisions S1–S14 and API assumptions in `docs/plans/web-s2.md`)
- `src/api/schema.ts` reconciled with `apps/api/openapi.snapshot.json` for everything S2 reads/writes (rules/tiers/rows, changes, proposals, preview, ledger, activity, eligibility + benefits, cash, denials, `ClaimSummary`/`PatientRef`/`PayerRef`) and the shared shapes (Strip's new totals, `AgentsStatus.agents`, `AdvanceOut`/`EventFired`, `ApproveOut.run` nullable). Endpoints, query keys (`['preview', p]`, `['eligibility','benefits',id]`), hooks (`hooks/useRules.ts`, `hooks/useStatic.ts`).
- **Settings › Agents** (interactive, `features/settings/`): tabs in the URL; tiered table (tier headers from the API, Action · Scope · Mode · floor + base rate / amber "no outcome data" · outcome · reverses in · ran 7 d · changed · owner sign-off); per-row mode control (hover/focus previews, click PATCHes, optimistic, 409 → revert + "Sent to Dr. Morgan for sign-off" + strip/inbox refetch; tier 3 "Human only", no control); live preview panel ("41 → 44 of this week's 54 … 3 of the 44 are root cause: ours → held for Dana · net 41"); practice cap editor (assumed endpoint) + per-rule cap with preview; Proposals cards (evidence, Accept / Edit / Dismiss, guard and "watching" cards disabled with the reason); Changes log + weekly owner digest; pause/resume. Billing can open Settings (read + propose); owner signs; owner sign-off items render as "Sign & apply" in the Inbox.
- **Static screens to their mocks**: Today's claims (leaving per file with editable-until, sent with 999 / Vyne / payer ack chips, held by days left with owner and next step, not billable), Activity (summary header, day/agent/outcome filters + Observe-mode preview in the URL, rows by day, evidence chips, `would_have_run` styling), Eligibility (schedule by day, `?date&appt`, benefits card: max left, deductible, frequencies, insurance/patient split, agent note → Inbox), Cash (KPI tiles with formulas, A/R aging / by payer / by provider bars + tables, write-offs, patient A/R, agent impact "estimate", every-KPI table), Denials (grouped by next action, path chip + tier, typed deadlines, "if we lose", ours/theirs, signer + checklist, payer × reason sidebar, appeal history for the owner; formal-appeal rows → mock-only workbench).
- **Clock advance UX**: sidebar shows spinner, events/runs/sim time from the firehose (polling fallback), control disabled while any advance runs; `useAdvanceCompletion` invalidates every query once per advance on whichever channel reports `done`.
- **Mock layer**: `mocks/db.ts` serves all of the above from a week-of-decisions fixture (53 = 41 + 12, by agent/tier exactly as 04-seed), computes the preview the way `services/rules.py` does, per-viewer inbox (`visible_inbox`), owner sign-off flow, proposals accept/guard, ledger/eligibility/cash/denials read models (denial routing ported from `torch_rcm/domain/routing.py`), and demo step 8 on the first crossing of Thu 07:10 (Denied 9, Paid 124, Inbox 16, Owens group denied + in flight from the 11:15 file). Fixtures aligned with the API seed (today's claims, rules, changes, proposals, overnight claims).
- **Tests**: `mocks/db.s2.test.ts`, `features/settings/selectors.test.ts`, `features/activity/search.test.ts` (Activity / Eligibility / Settings params), `features/denials/selectors.test.ts` (+ ledger ack chips); component test `features/settings/SettingsAgentsPage.test.tsx`; e2e `demo.spec.ts` now steps 1–10 (@demo) plus a static-screens test.

**Verified offline** (no registry): all 140 files parse; React-free modules and pure tests typecheck under strict + `noUncheckedIndexedAccess`; the whole `src/` typechecks against typed library stubs kept outside the repo; **69 pure tests pass** through the shim (UTC and Asia/Tokyo). Not run: lint, real-library typecheck, component tests, build, Playwright.

**Blocked**
- Same registry block as web-shell. First run: `cd apps/web && pnpm install && pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm e2e`.

**Next**
- Fix whatever the first lint/typecheck reports; run e2e against mocks, then `E2E_TARGET=real` once torch_rcm.agents creates the overnight items.
- Migrate the S1 shapes (Inbox, ClaimRow, ClaimDetail, RunDetail, `itm_` ids) to the API via `pnpm gen:api` (web-s2.md §3).
- Coordinator: spec edits (06 step 6 + step 8 wording, 05 Settings guard, 02 `PATCH /settings/practice`); api-core: practice-cap endpoint, typed deadlines on overnight denials, benefits `last_done`, `nav_badges`.

### agents (slice C)

**Done**
- `torch_rcm/agents/definitions/` — declarative `AgentDefinition` per agent (07 §2) + `registry()`; proposable tiers derived from the catalog; `assert_definition()` refuses a proposable tier-3 action (Appeals lists `formal_appeal` under `prepares_only`).
- `torch_rcm/agents/learning.py` — pure `proposal_eligible` (exact-fraction edges, `ours` → eligible-but-guarded), `acceptable`, `draft_rule` (auto, floor 0.90, p95 cap rounded up to $500), `demotion_due`.
- Additive: `guardrails.terminal_protocol_violation()`, `AgentConfig.budget_stop()`.
- Tests: `tests/agents/` (policy table every row + invariants + seeded-loop properties, catalog closure, definitions, learning, guardrails, strict schemas, scripted/recorded planner on the pinned cases after the Thursday advance) and `tests/adversarial/` (prompt injection, tier-3 proposals, budgets, terminal-with-reads). Helpers in `tests/agent_world.py`. 195 new tests green, 1 strict xfail.
- Fixes in core: `EvidenceSet.first()` `kind` param made positional-only (the PA/records scripts crashed on `kind="pa"`); Appeals given the claim reads in `AGENT_READS` (07 §2 "all claim reads"; its packet reads were all refused).

**Open / gaps**
- xfail `test_foster_remittance_is_a_variance`: `case._remittance_case` classifies by arithmetic balance only, so Foster's PR-1 "deductible applied though met" line posts as `era:balanced`; 04-seed expects a `variance`.
- `clm_4800` (Moreno CO-22): only one coverage is seeded, so the COB script ends "needs a person" rather than proposing `cob_order_change` (tier 2 → no rule → Dana) as 04-seed describes; tested both ways.

### agents (slice A)

**Done**
- `torch_rcm/agents/executor/` — `Executor.run(run_id)`: fixed pipeline `gather_case → investigate → decide → act:* (recipe) → report`; every world step keyed `{run_id}:{step_idx}:{op}`; RunSteps pending→running→ok/failed/skipped with progress lines, evidence ids and policy verdict; checkpoint after every step pinned to `{model, effort, thinking, system_sha, tools_sha}` (scripted: `system_sha=planner=scripted`), resume from the last ok step (a step left `running` re-executes and gets the stored world result); seeded step delays (`delay_scale`, 0 in tests); world evidence candidates → Evidence rows (`ev_ + sha256(run, idx, seq)`, `world_call_id` provenance); code-built audit line (07 §5.5); `WorldUnavailable` → `world_retry_backoff_s` retries → run failed, `run_failed` item only when a file time or a deadline (≤ `decision_risk_days`) is at risk; triage `propose` reuses or opens one item per (claim, action); `cannot_decide` → one "Needs a person" item.
- `torch_rcm/agents/runtime.py` — `RunStore`, `EventBus` (persisted via `torch_rcm.events`, in-process fan-out + store polling fallback, Last-Event-ID replay, seeded runs replay their steps), `AdvanceLimits` (live concurrency / per-advance cap; no-ops deterministic), `AgentRuntime` (`start_run`, `triage`, `pause`/`resume`, `recover`, `status`, outage reschedule +2 h for non-approval runs, LivePlanner slot).
- `torch_rcm/agents/handlers.py` — `register(reg, cfg)`: `run.start`, `triage` (new kind in `scheduler/kinds.py`, in `AGENT_KINDS`), `era.arrived` → one Follow-up `triage` job per denied claim. `torch_rcm/agents/api_hooks.py` — `include_agents(app)` (adds only missing routes). `torch_rcm/agents/cli.py` — `register(cli)`: `eval` (if absent), `cassette record`.
- Config: `AgentConfig.world_retry_backoff_s`, `outage_reschedule_minutes`, `decision_risk_days`.
- Tests: `tests/agents/test_executor.py`, `tests/agents/test_runtime.py` (19).

**Open / next**
- Wiring into the API app: two lines in `docs/plans/agents-integration.md` (not applied; no extension point).
- Not in slice A: `claim.rejected`, `claim.status_check_due`, `prompt_pay.due`, `visit.checked_out`, `hold.escalate`, `eligibility.sweep` handlers; posting runs on `era.arrived`; alternate channel on outage (portal → IVR → 276); `required_evidence` back-fill ("added by Torch"); `run_checkpoints`-based re-plan on pin mismatch for live runs (state is kept, messages dropped).
- `api_hooks` / `cli` are untested here (fastapi, typer not importable).

### agents (slice B)

**Done**
- `torch_rcm/agents/prompts/{claims,followup,appeals}.md` + `prompts/__init__.py`: static system prompts (role, tier policy, closed action list, may/may-not, situation catalog, untrusted `<world_content>` rule, terminal-tool protocol, drafting rules); `load()`, `system_sha`, `tools_for(agent, plan|draft)`, `tools_sha_for`, `plans_live()` (Appeals: scripted plan, live drafting only).
- `torch_rcm/agents/llm/client.py`: pure `build_request(agent, messages, *, model_role)` from the capability table (no sampling params; exec = Sonnet `between_tools`/medium/auto; draft = Opus adaptive/high/auto; fast = Haiku disabled + forced tool, no effort; top-level automatic `cache_control` + one marker on the last system block; strict linted tools; `max_tokens` from config). `LlmClient.messages_create(meta, **body)`: lazy `anthropic` import (`SdkTransport`, `max_retries=0`, non-SDK keys via `extra_body`), retries 429/5xx/529/connection with 1 s·2ⁿ ±25 % (honours `retry-after`, ≤ 30 s), 400 → `LlmBadRequest`, 401/403 → `LiveModeDisabled`, `stop_reason` mapping incl. `refusal`, one `LlmCallRecord` per call (→ `LlmCall` entity; `purpose` field added). `llm/pricing.toml` (cache write 1.25×, read 0.05× Sonnet/Opus, 0.1× Haiku; list prices to re-check before quoting).
- `torch_rcm/agents/llm/cassette.py`: JSONL cassettes (header with `synthetic`, `recorded_at`, `hash_mode`, key {agent, situation_key, system_sha, tools_sha, model, effort, thinking}; one line per call). `CassetteClient` (strict: key mismatch, missing call or request-hash drift → `CassetteMiss`), `RecordingClient`, `synthetic_cassette()`, `restamp_synthetic()` (synthetic only), `record_canonical()` / `record()` for `torch cassette record`.
- `torch_rcm/agents/planner/live.py`: `LivePlanner` (plan loop, one repair turn shared by terminal-with-reads / wrong terminal / schema violation, end_turn nudge, max_tokens retry at 2×, budget check before each call, refusal / API error / `CassetteMiss` → `PlannerFallback(reason)`, thinking blocks passed back unmodified, pin + checkpoint hook, Opus `draft()` with `submit_draft` + text guard + one repair). Code rejects confidence/tier/root cause/amounts, tier-3 or off-list actions, out-of-scope ids and unknown evidence. Evidence is shown under run-local handles `E1…` so messages replay byte-identically. `registry_reader()` for recording/tests.
- `cassettes/canonical/{clm_4821_group,clm_4744,clm_4709,clm_4731,clm_4796_appeal}.jsonl`: hand-authored, `synthetic: true`, structural hash. They replay against the seeded world and reproduce the reviewed plans.
- `torch_rcm/agents/testing/fakes.py`; tests `tests/agents/test_llm_client.py`, `test_live_planner.py`, `test_cassette.py` (48).
- `llm/models.py`: Haiku 5.5 accepts effort (default medium) per the red-team facts; the fast profile still omits it.

**Open / next**
- Re-record the canonical cassettes with a key (`torch cassette record`), then switch them to `hash_mode: full`. The appeal cassette assumes the draft run has ≥ 2 evidence items (E1, E2).
- Live `submit_result` turn not used: `result()` is the code-built text. No mid-conversation resume (`pin_matches()` exists; on a mismatch, re-plan).
- Wire `AgentRuntime.llm_client` (`LlmClient(cfg, sink=…, clock=…)` or `CassetteClient(Path("cassettes/canonical"), …)` per `TORCH_CASSETTE_MODE`), and persist `LlmCallRecord.to_entity()` from the sink.

### integration

**Done**
- Eval harness `apps/api/torch_rcm/agents/eval/` (`harness.py`, `__init__.py` → `run_eval`, `__main__.py` → `main`; `torch eval` and `torch_rcm.agents.cli.run_eval_command` call it): seeds canonical, approves the Delta group, triages #4744/#4709/#4731, runs to Thu 07:10, in deterministic and live (`CassetteClient` over `cassettes/canonical`) modes; compares per-run action / step names / evidence kinds / item kind / status; property-checks the unknowns against the `envelope` now declared in `planner/recorded/*.plan.json` (never executed, no world mutation, one open item); asserts the 01 invariants (seed and Thu) and 04-seed reconciled numbers; prints a table, exit 1 on any mismatch. `tests/agents/test_eval.py`. Runs in ~4 s; its end state is Inbox 19 because it triages all three unknowns (the demo triages only #4744 → 17).
- Foster variance: `PlanBenefits.deductible_met_on` + `case._benefit_variances` → `era:variance` "deductible applied though met 05/12"; xfail removed.
- Moreno COB: second coverage seeded (MetLife, secondary) → `cob_order_change` tier 2 "no rule → Dana". Castillo: agent-sent FMX on file → root cause `ours` → held for Dana.
- `era.arrived` routes by `route_denial` (Ito/Morris → Appeals); `claim.status_check_due` handler; executor maps trigger `schedule` → `claim.status_check_due`.
- API: `PATCH /settings/practice` (owner, 403 `owner_only`, 422 `invalid_cap`, audit); `Strip.paid_month_label` + `nav_badges {payments, eligibility, activity}`; typed overnight deadlines (`routing.denial_deadline` from the world's 835 handler); J. Chen / S. Kim PMS history visits → `frequencies[].last_done/ok_from` (history codes with a frequency rule are listed too). `GET /settings/preview` already counted 53/54 incl. approved items: Delta rule → 41 · held ours 3 · total 54 after 3b (confirmed, no change).
- `adapters._act("nea.upload")` returns `reference`. `openapi.snapshot.json` regenerated from the contract table (48 paths, 147 schemas).
- Specs: 02 (strip badges, preview, PATCH practice), 03 (Delta 835 Mon/Thu, D2392 → D2150 PR-186), 04 (fees D4341 $240 / D2392 $255, Chen stale-plan note, history dates, #4748 D2150), 05 (Settings: owner + billing), 06 (step 6 Delta rule wording; step 8 = **17** with composition and deadlines), 07 §10 (layout, scheduler in `torch_rcm/scheduler/`). ADR-0002.
- Tests: 365 passed, 2 skipped, 0 xfailed (was 356 / 2 / 1 xfail).

**Demo numbers after step 3, 3b and the Thu 07:10 advance (deterministic):** Inbox 17 (approve_action 10, review_draft 3, eligibility_flag 3, variance 1) · strip Ready 3 · Sent 1 · Rejected 1 · Accepted 8 · Pending 71 · Denied 9 · Appealed 3 · Partial 5 · Paid Oct 124 · nav badges payments 7 / eligibility 3 / activity 41.

**First run with packages must verify**
- `make gen-api` (web `schema.ts`: `nav_badges`, `paid_month_label` become required; `PracticeSettings*`, `PlanBenefits.deductible_met_on`), `make lint` (ruff/mypy were not runnable here), FastAPI contract tests (route table vs app incl. `PATCH /settings/practice`), `make eval` via typer.
- Web mock step 8 still composes 16 from Lindgren + a held ERA line; re-align to the API's 17 (ADR-0002) and the e2e expectation.
- Live mode against the real API: Castillo/Moreno have no cassette and replay as `scripted_fallback` (same shape); re-record cassettes with a key.

**Still open**
- No handlers for `visit.checked_out` (claim building), `eligibility.sweep`, posting on `era.arrived`, `claim.rejected`, `hold.escalate`, `prompt_pay.due`; overnight 835s stay `needs_review`.

### review fix pass (web)

From `docs/design/red-team/challenge-repo-review-2026-11-01.md` (items 4–5, red flags 3 and 7, "Web against the real API").

**Done**
- SSE `done` bug: the pure `reduceRunMessage` (`src/lib/runEvents.ts`) never assumes an outcome. A `done` that fails to parse, or has no status, leaves the status unchanged and returns `desynced`. `useRun` then sets mode `desynced`, refetches `['run', id]` and polls every 2 s until the server's `Run.status` is terminal. `applyDoneEvent` no longer defaults to `succeeded`. `invalidateAfterRun` now invalidates `qk.run` (`staleTime` is Infinity) and `['strip']` as well as inbox, claims, activity, preview and agents. `mergeSnapshot` lets a terminal server status win, so a failed run renders as failed. ProgressPanel shows "stream lost · checking the server" while desynced, and a cancelled chip.
- Shapes now match the API: `GET /runs/{id}` parses `RunDetail {run, evidence, last_event_id}`. `['run', id]` caches a `RunView` (Run + evidence + cursor), built by `runViewOf` from a RunDetail or from a mutation's bare Run. `InboxItem` = `InboxItemOut`: nested `claim` (ClaimSummary) and `patient` (PatientRef), `evidence_ids`, `priority`, `suspicious_evidence`. `InboxItemDetail` adds `plan_steps`, `audit_note`, hydrated `evidence`, `payload` and `hold_window` (replacing `reversibility`). `InboxList` has `total_cents` and no `facets` (the per-kind tab counts are gone; only the server's total is shown). The assumed `subject` is gone: InboxDetail, InboxList, InboxPage (`Enter` / `g c` / corrected claim), the launch labels and `settle()` read `claim` and `patient`. `.strict()` is now on Evidence, InboxItem, InboxItemDetail, InboxList, HoldWindow, Run, RunStep, RunDetail, Usage, ClaimSummary, PatientRef, PayerRef and Confidence. Their key sets were checked against `openapi.snapshot.json` (all 13 match) and their enums against the API's (all accepted).
- Mock follows the API: `fixtures/inbox.ts` stores `MockInboxItem`, which has the API's domain-row shape (`claim_id`, `evidence_ids`, plan, audit note). `db.ts` builds `InboxItemOut` / `InboxItemDetail` from it the way `readmodels/inbox.py` does (patient from the claim or the appointment; root cause from the item or the claim's denial; hold window from the claim's queued file). Every response returns these wire shapes, including the list, detail, mutations and `ClaimDetail.open_inbox_items`. `run()` returns `RunDetail`, and approve, group and triage responses return a bare `Run`. One gap remains: the mock's `priority` is its stored order, not the API's formula.
- Cash: `insurance_collections_month` and `collections_month` are now derived from the same paid rows and pricing as the strip. Wed shows 118 / $61,300; after the Thu advance, 124 / $64,746.46.
- `scripts/gen-api.mjs` writes `src/api/generated.ts` with strict objects. `schema.ts` carries a one-line header: it is the hand-maintained mirror until `pnpm gen:api` has run with registry access, and after that it should re-export from `generated.ts`. Generation has **not** run. `src/__probe.ts` was already gone.
- Tests: `runEvents.test.ts` has 4 new cases (malformed, non-schema and status-less `done` → desynced, with no `succeeded`; server `failed` wins after a desync; `runViewOf`). `db.test.ts` has a new case: wire shapes parse under the strict schemas, `RunDetail`, no `claim_id` on rows. `db.s2.test.ts` checks the Cash Paid figures on Wed and Thu. `ProgressPanel.test.tsx` serves a `RunDetail`.

**Verified offline:** 74/74 pure tests pass through the vitest shim, in UTC and Asia/Tokyo. Whole `src/` typechecks against the stub set and shows no new errors beyond the stub-only baseline. A throwaway script strict-parsed every mock response (list, detail, claim, run, approve, group, triage, reject/snooze/reopen) on Wed, after step 3b and after the Thu advance: all OK. **Not run:** lint, real-library typecheck, component tests (ProgressPanel, InboxPage) and Playwright.

**Next**
- First run with packages: `pnpm gen:api`, switch `schema.ts` to re-export, and run `pnpm typecheck test e2e` against `make dev` with the real API, not the mock.
- `ClaimRow` / `ClaimDetail` are still the S1 shapes (not strict). Reconcile them next.

### review fix pass (api)

From `docs/design/red-team/challenge-repo-review-2026-11-01.md` ("Decision taken"), Python side.

**Done**
- **Package renamed `torch` → `torch_rcm`** (it shadowed PyTorch). The CLI is still `torch` (`torch = "torch_rcm.cli:main"`). Updated: every import, `pyproject.toml` (wheel package, isort first-party, per-file ignores, mypy overrides), `Makefile` (`uvicorn torch_rcm.api.app:app`, `mypy torch_rcm`), `infra/api.Dockerfile`, `infra/docker-compose.yml`, `.github/workflows/ci.yml`, `CLAUDE.md`, specs 01/03/04/07, ADR-0002, `docs/plans/*`, `FIRST_RUN.md`, web comments that cite API paths, and `openapi.snapshot.json`. `CANONICAL_DIR` (`parents[3]`) still resolves to `apps/api/cassettes`. Red-team reports keep the old paths as historical records.
- **Agents never silently missing:** `api/app.py::_load_agents` logs `agents.import_failed` with the exception and re-raises, so the API refuses to boot inert. `TORCH_ALLOW_WORLD_ONLY=1` (new `Settings.allow_world_only`, in `.env.example`) boots world-only on purpose. Removed the dead branch in `policy.py::_row15`.
- **Observe mode on approval:** row 7 is now re-checked on approval runs (rows 0, 1, 3, 7, 14, 15). Approving an item whose rule has since become `observe` gives a `would_have_run` run with no `act:*` steps and no world call. The item gets `payload.approval_outcome = "would_have_run"`, `approval_run_id` and a "Would have run · …" `resolution_note` (`Executor._mark_observed_approval`). Spec 07 §5.1 is updated to match. Tests are in `tests/agents/test_policy_table.py`: the decision itself, and the end-to-end itm_4821 run under an observe rule.
- **Transitions** (`domain/transitions.py`): edges are now `move | spawn | close`. Added: `partial → pending` (reconsideration, tier 1); `partial → appealed` (tier 3); corrected claim (`spawn`, tier 2) from denied, partial, rejected, sent, accepted or pending, via `start_corrected_claim` (a new `ready` claim with a parent link, which reaches `sent` when its file departs); write-off (denied or partial) and void (anything but paid) as `close` edges, via `close_claim` (status unchanged, returns the `ClosedReason`). Every tier-3 edge also needs `by_human=True`. `services/claims.py::void_claim` and `corrected_claim` now gate through these. Spec 01 was widened to the corrected-claim sources the service already accepted. Tests are in `tests/test_domain.py`. *Not wired:* the agent recipe's `vyne.build_corrected` adapter (`tools/adapters.py::_corrected`) still builds the replacement without calling `start_corrected_claim`.
- **`Idempotency-Key` honoured server-side:** there is a new `IdempotencyRecord` entity (`idempotency` table, id derived from `(user_id, key)`) and `api/services/idempotency.py::idempotent`. It covers approve, approve-group, reject, snooze, `PATCH /rules/{id}` and `PATCH /settings/practice`. The first successful response is stored and replayed; the same key on a different request returns `422 idempotency_key_reused`; refusals are not stored; each keyed mutation runs in one write transaction. The routers read the header through `deps.IdempotencyKey`. The contract table has `Route.idempotent`, the snapshot was regenerated, and spec 02 is updated. Tests: `tests/test_idempotency.py` (9, pure service).
- **Executor split:** `run` is now a short sequencer over `_begin`, `_gather_case`, `_reconcile_checkpoint`, `_investigate`, `_decide` (+ `_act_layout`), `_act_steps` / `_act_step`, and `_report`. The `noqa: PLR0912, PLR0915` is gone. Planners are typed by the `Planner` Protocol (`planner/base.py`: `kind`, `usage`, `pin`, `transcript`, `expected_pin`, `plan`, `draft`, `result`), with no `Any` and no `getattr`. `scripted_pin` moved to `planner/scripted.py`, and the `live.make_planner` seam is now a typed module attribute. ADR-0001 is implemented: a pre-plan checkpoint under another pin is discarded (conversation and state) and the run re-plans, adding a "re-planning" progress line; after a plan exists the stored plan continues. Two new tests are in `tests/agents/test_executor.py`. Existing executor tests are unchanged. The only test edit is the `StubLive` in `test_runtime.py`, which gained `transcript`/`expected_pin` to satisfy the Protocol.
- **Lint:** `line-length = 120` was already configured. `ruff check . --fix` and `ruff format .` were run, then the remaining errors fixed by hand (E501, RUF028 invalid `fmt: skip`, RUF012, RUF036, SIM102/105, PIE810, C416, UP047, PLR0915 in the eval harness). `sqlmodel` is gone from dependencies; nothing imports SQLAlchemy.
- **mypy scope:** strict now applies to `torch_rcm.domain.*` **and** `torch_rcm.agents.*`, as CLAUDE.md promises.

**Verified offline:** `python3 -m pytest -q tests` gives 391 passed, 2 skipped. `python3 -m torch_rcm.agents.eval` gives `eval: OK`. ruff 0.16.9: `ruff check .` and `ruff format --check .` are clean.

**First run with packages must verify**
- `uv sync` (the package rename needs a fresh install), then `uv run mypy torch_rcm`. Strict on `agents` has never run. Expect first-run work on: the remaining `Any` parameters (`_policy_ctx(draft_guard)`, `_load_live_planner(on_progress)`, `_reader`), the `type: ignore[arg-type]` sites (`executor._case`, `StepResult`), unused-ignore warnings now that the stricter flags apply, `planner/live.py` (683 lines), and the pydantic plugin over the `Planner` Protocol attributes. Fix rather than weaken the override.
- FastAPI: the routers with the new `IdempotencyKey` header dependency; `test_api_contract.py` (FastAPI names the header `Idempotency-Key`, and the contract table should match); lifespan refusing to boot when `torch_rcm.agents` fails to import; `TORCH_ALLOW_WORLD_ONLY=1`. Then regenerate `openapi.snapshot.json` from FastAPI (`uv run torch openapi`) and `make gen-api`.
- typer CLI: `uv run torch seed | openapi | eval | advance` through the `torch_rcm.cli:main` entry point.
- Existing local DBs need no reseed: the `idempotency` table is created on open (`CREATE TABLE IF NOT EXISTS`).
