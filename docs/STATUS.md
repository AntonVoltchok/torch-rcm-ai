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

### web-s2

**Done** (`apps/web/`, decisions S1–S14 and API assumptions in `docs/plans/web-s2.md`)
- `src/api/schema.ts` reconciled with `apps/api/openapi.snapshot.json` for everything S2 reads/writes (rules/tiers/rows, changes, proposals, preview, ledger, activity, eligibility + benefits, cash, denials, `ClaimSummary`/`PatientRef`/`PayerRef`) and the shared shapes (Strip's new totals, `AgentsStatus.agents`, `AdvanceOut`/`EventFired`, `ApproveOut.run` nullable). Endpoints, query keys (`['preview', p]`, `['eligibility','benefits',id]`), hooks (`hooks/useRules.ts`, `hooks/useStatic.ts`).
- **Settings › Agents** (interactive, `features/settings/`): tabs in the URL; tiered table (tier headers from the API, Action · Scope · Mode · floor + base rate / amber "no outcome data" · outcome · reverses in · ran 7 d · changed · owner sign-off); per-row mode control (hover/focus previews, click PATCHes, optimistic, 409 → revert + "Sent to Dr. Morgan for sign-off" + strip/inbox refetch; tier 3 "Human only", no control); live preview panel ("41 → 44 of this week's 54 … 3 of the 44 are root cause: ours → held for Dana · net 41"); practice cap editor (assumed endpoint) + per-rule cap with preview; Proposals cards (evidence, Accept / Edit / Dismiss, guard and "watching" cards disabled with the reason); Changes log + weekly owner digest; pause/resume. Billing can open Settings (read + propose); owner signs; owner sign-off items render as "Sign & apply" in the Inbox.
- **Static screens to their mocks**: Today's claims (leaving per file with editable-until, sent with 999 / Vyne / payer ack chips, held by days left with owner and next step, not billable), Activity (summary header, day/agent/outcome filters + Observe-mode preview in the URL, rows by day, evidence chips, `would_have_run` styling), Eligibility (schedule by day, `?date&appt`, benefits card: max left, deductible, frequencies, insurance/patient split, agent note → Inbox), Cash (KPI tiles with formulas, A/R aging / by payer / by provider bars + tables, write-offs, patient A/R, agent impact "estimate", every-KPI table), Denials (grouped by next action, path chip + tier, typed deadlines, "if we lose", ours/theirs, signer + checklist, payer × reason sidebar, appeal history for the owner; formal-appeal rows → mock-only workbench).
- **Clock advance UX**: sidebar shows spinner, events/runs/sim time from the firehose (polling fallback), control disabled while any advance runs; `useAdvanceCompletion` invalidates every query once per advance on whichever channel reports `done`.
- **Mock layer**: `mocks/db.ts` serves all of the above from a week-of-decisions fixture (53 = 41 + 12, by agent/tier exactly as 04-seed), computes the preview the way `services/rules.py` does, per-viewer inbox (`visible_inbox`), owner sign-off flow, proposals accept/guard, ledger/eligibility/cash/denials read models (denial routing ported from `torch/domain/routing.py`), and demo step 8 on the first crossing of Thu 07:10 (Denied 9, Paid 124, Inbox 16, Owens group denied + in flight from the 11:15 file). Fixtures aligned with the API seed (today's claims, rules, changes, proposals, overnight claims).
- **Tests**: `mocks/db.s2.test.ts`, `features/settings/selectors.test.ts`, `features/activity/search.test.ts` (Activity / Eligibility / Settings params), `features/denials/selectors.test.ts` (+ ledger ack chips); component test `features/settings/SettingsAgentsPage.test.tsx`; e2e `demo.spec.ts` now steps 1–10 (@demo) plus a static-screens test.

**Verified offline** (no registry): all 140 files parse; React-free modules and pure tests typecheck under strict + `noUncheckedIndexedAccess`; the whole `src/` typechecks against typed library stubs kept outside the repo; **69 pure tests pass** through the shim (UTC and Asia/Tokyo). Not run: lint, real-library typecheck, component tests, build, Playwright.

**Blocked**
- Same registry block as web-shell. First run: `cd apps/web && pnpm install && pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm e2e`.

**Next**
- Fix whatever the first lint/typecheck reports; run e2e against mocks, then `E2E_TARGET=real` once torch.agents creates the overnight items.
- Migrate the S1 shapes (Inbox, ClaimRow, ClaimDetail, RunDetail, `itm_` ids) to the API via `pnpm gen:api` (web-s2.md §3).
- Coordinator: spec edits (06 step 6 + step 8 wording, 05 Settings guard, 02 `PATCH /settings/practice`); api-core: practice-cap endpoint, typed deadlines on overnight denials, benefits `last_done`, `nav_badges`.

### agents (slice C)

**Done**
- `torch/agents/definitions/` — declarative `AgentDefinition` per agent (07 §2) + `registry()`; proposable tiers derived from the catalog; `assert_definition()` refuses a proposable tier-3 action (Appeals lists `formal_appeal` under `prepares_only`).
- `torch/agents/learning.py` — pure `proposal_eligible` (exact-fraction edges, `ours` → eligible-but-guarded), `acceptable`, `draft_rule` (auto, floor 0.90, p95 cap rounded up to $500), `demotion_due`.
- Additive: `guardrails.terminal_protocol_violation()`, `AgentConfig.budget_stop()`.
- Tests: `tests/agents/` (policy table every row + invariants + seeded-loop properties, catalog closure, definitions, learning, guardrails, strict schemas, scripted/recorded planner on the pinned cases after the Thursday advance) and `tests/adversarial/` (prompt injection, tier-3 proposals, budgets, terminal-with-reads). Helpers in `tests/agent_world.py`. 195 new tests green, 1 strict xfail.
- Fixes in core: `EvidenceSet.first()` `kind` param made positional-only (the PA/records scripts crashed on `kind="pa"`); Appeals given the claim reads in `AGENT_READS` (07 §2 "all claim reads"; its packet reads were all refused).

**Open / gaps**
- xfail `test_foster_remittance_is_a_variance`: `case._remittance_case` classifies by arithmetic balance only, so Foster's PR-1 "deductible applied though met" line posts as `era:balanced`; 04-seed expects a `variance`.
- `clm_4800` (Moreno CO-22): only one coverage is seeded, so the COB script ends "needs a person" rather than proposing `cob_order_change` (tier 2 → no rule → Dana) as 04-seed describes; tested both ways.

### agents (slice A)

**Done**
- `torch/agents/executor/` — `Executor.run(run_id)`: fixed pipeline `gather_case → investigate → decide → act:* (recipe) → report`; every world step keyed `{run_id}:{step_idx}:{op}`; RunSteps pending→running→ok/failed/skipped with progress lines, evidence ids and policy verdict; checkpoint after every step pinned to `{model, effort, thinking, system_sha, tools_sha}` (scripted: `system_sha=planner=scripted`), resume from the last ok step (a step left `running` re-executes and gets the stored world result); seeded step delays (`delay_scale`, 0 in tests); world evidence candidates → Evidence rows (`ev_ + sha256(run, idx, seq)`, `world_call_id` provenance); code-built audit line (07 §5.5); `WorldUnavailable` → `world_retry_backoff_s` retries → run failed, `run_failed` item only when a file time or a deadline (≤ `decision_risk_days`) is at risk; triage `propose` reuses or opens one item per (claim, action); `cannot_decide` → one "Needs a person" item.
- `torch/agents/runtime.py` — `RunStore`, `EventBus` (persisted via `torch.events`, in-process fan-out + store polling fallback, Last-Event-ID replay, seeded runs replay their steps), `AdvanceLimits` (live concurrency / per-advance cap; no-ops deterministic), `AgentRuntime` (`start_run`, `triage`, `pause`/`resume`, `recover`, `status`, outage reschedule +2 h for non-approval runs, LivePlanner slot).
- `torch/agents/handlers.py` — `register(reg, cfg)`: `run.start`, `triage` (new kind in `scheduler/kinds.py`, in `AGENT_KINDS`), `era.arrived` → one Follow-up `triage` job per denied claim. `torch/agents/api_hooks.py` — `include_agents(app)` (adds only missing routes). `torch/agents/cli.py` — `register(cli)`: `eval` (if absent), `cassette record`.
- Config: `AgentConfig.world_retry_backoff_s`, `outage_reschedule_minutes`, `decision_risk_days`.
- Tests: `tests/agents/test_executor.py`, `tests/agents/test_runtime.py` (19).

**Open / next**
- Wiring into the API app: two lines in `docs/plans/agents-integration.md` (not applied; no extension point).
- Not in slice A: `claim.rejected`, `claim.status_check_due`, `prompt_pay.due`, `visit.checked_out`, `hold.escalate`, `eligibility.sweep` handlers; posting runs on `era.arrived`; alternate channel on outage (portal → IVR → 276); `required_evidence` back-fill ("added by Torch"); `run_checkpoints`-based re-plan on pin mismatch for live runs (state is kept, messages dropped).
- `api_hooks` / `cli` are untested here (fastapi, typer not importable).

### agents (slice B)

**Done**
- `torch/agents/prompts/{claims,followup,appeals}.md` + `prompts/__init__.py`: static system prompts (role, tier policy, closed action list, may/may-not, situation catalog, untrusted `<world_content>` rule, terminal-tool protocol, drafting rules); `load()`, `system_sha`, `tools_for(agent, plan|draft)`, `tools_sha_for`, `plans_live()` (Appeals: scripted plan, live drafting only).
- `torch/agents/llm/client.py`: pure `build_request(agent, messages, *, model_role)` from the capability table (no sampling params; exec = Sonnet `between_tools`/medium/auto; draft = Opus adaptive/high/auto; fast = Haiku disabled + forced tool, no effort; top-level automatic `cache_control` + one marker on the last system block; strict linted tools; `max_tokens` from config). `LlmClient.messages_create(meta, **body)`: lazy `anthropic` import (`SdkTransport`, `max_retries=0`, non-SDK keys via `extra_body`), retries 429/5xx/529/connection with 1 s·2ⁿ ±25 % (honours `retry-after`, ≤ 30 s), 400 → `LlmBadRequest`, 401/403 → `LiveModeDisabled`, `stop_reason` mapping incl. `refusal`, one `LlmCallRecord` per call (→ `LlmCall` entity; `purpose` field added). `llm/pricing.toml` (cache write 1.25×, read 0.05× Sonnet/Opus, 0.1× Haiku; list prices to re-check before quoting).
- `torch/agents/llm/cassette.py`: JSONL cassettes (header with `synthetic`, `recorded_at`, `hash_mode`, key {agent, situation_key, system_sha, tools_sha, model, effort, thinking}; one line per call). `CassetteClient` (strict: key mismatch, missing call or request-hash drift → `CassetteMiss`), `RecordingClient`, `synthetic_cassette()`, `restamp_synthetic()` (synthetic only), `record_canonical()` / `record()` for `torch cassette record`.
- `torch/agents/planner/live.py`: `LivePlanner` (plan loop, one repair turn shared by terminal-with-reads / wrong terminal / schema violation, end_turn nudge, max_tokens retry at 2×, budget check before each call, refusal / API error / `CassetteMiss` → `PlannerFallback(reason)`, thinking blocks passed back unmodified, pin + checkpoint hook, Opus `draft()` with `submit_draft` + text guard + one repair). Code rejects confidence/tier/root cause/amounts, tier-3 or off-list actions, out-of-scope ids and unknown evidence. Evidence is shown under run-local handles `E1…` so messages replay byte-identically. `registry_reader()` for recording/tests.
- `cassettes/canonical/{clm_4821_group,clm_4744,clm_4709,clm_4731,clm_4796_appeal}.jsonl`: hand-authored, `synthetic: true`, structural hash. They replay against the seeded world and reproduce the reviewed plans.
- `torch/agents/testing/fakes.py`; tests `tests/agents/test_llm_client.py`, `test_live_planner.py`, `test_cassette.py` (48).
- `llm/models.py`: Haiku 5.5 accepts effort (default medium) per the red-team facts; the fast profile still omits it.

**Open / next**
- Re-record the canonical cassettes with a key (`torch cassette record`), then switch them to `hash_mode: full`. The appeal cassette assumes the draft run has ≥ 2 evidence items (E1, E2).
- Live `submit_result` turn not used: `result()` is the code-built text. No mid-conversation resume (`pin_matches()` exists; on a mismatch, re-plan).
- Wire `AgentRuntime.llm_client` (`LlmClient(cfg, sink=…, clock=…)` or `CassetteClient(Path("cassettes/canonical"), …)` per `TORCH_CASSETTE_MODE`), and persist `LlmCallRecord.to_entity()` from the sink.

### integration

**Done**
- Eval harness `apps/api/torch/agents/eval/` (`harness.py`, `__init__.py` → `run_eval`, `__main__.py` → `main`; `torch eval` and `torch.agents.cli.run_eval_command` call it): seeds canonical, approves the Delta group, triages #4744/#4709/#4731, runs to Thu 07:10, in deterministic and live (`CassetteClient` over `cassettes/canonical`) modes; compares per-run action / step names / evidence kinds / item kind / status; property-checks the unknowns against the `envelope` now declared in `planner/recorded/*.plan.json` (never executed, no world mutation, one open item); asserts the 01 invariants (seed and Thu) and 04-seed reconciled numbers; prints a table, exit 1 on any mismatch. `tests/agents/test_eval.py`. Runs in ~4 s; its end state is Inbox 19 because it triages all three unknowns (the demo triages only #4744 → 17).
- Foster variance: `PlanBenefits.deductible_met_on` + `case._benefit_variances` → `era:variance` "deductible applied though met 05/12"; xfail removed.
- Moreno COB: second coverage seeded (MetLife, secondary) → `cob_order_change` tier 2 "no rule → Dana". Castillo: agent-sent FMX on file → root cause `ours` → held for Dana.
- `era.arrived` routes by `route_denial` (Ito/Morris → Appeals); `claim.status_check_due` handler; executor maps trigger `schedule` → `claim.status_check_due`.
- API: `PATCH /settings/practice` (owner, 403 `owner_only`, 422 `invalid_cap`, audit); `Strip.paid_month_label` + `nav_badges {payments, eligibility, activity}`; typed overnight deadlines (`routing.denial_deadline` from the world's 835 handler); J. Chen / S. Kim PMS history visits → `frequencies[].last_done/ok_from` (history codes with a frequency rule are listed too). `GET /settings/preview` already counted 53/54 incl. approved items: Delta rule → 41 · held ours 3 · total 54 after 3b (confirmed, no change).
- `adapters._act("nea.upload")` returns `reference`. `openapi.snapshot.json` regenerated from the contract table (48 paths, 147 schemas).
- Specs: 02 (strip badges, preview, PATCH practice), 03 (Delta 835 Mon/Thu, D2392 → D2150 PR-186), 04 (fees D4341 $240 / D2392 $255, Chen stale-plan note, history dates, #4748 D2150), 05 (Settings: owner + billing), 06 (step 6 Delta rule wording; step 8 = **17** with composition and deadlines), 07 §10 (layout, scheduler in `torch/scheduler/`). ADR-0002.
- Tests: 365 passed, 2 skipped, 0 xfailed (was 356 / 2 / 1 xfail).

**Demo numbers after step 3, 3b and the Thu 07:10 advance (deterministic):** Inbox 17 (approve_action 10, review_draft 3, eligibility_flag 3, variance 1) · strip Ready 3 · Sent 1 · Rejected 1 · Accepted 8 · Pending 71 · Denied 9 · Appealed 3 · Partial 5 · Paid Oct 124 · nav badges payments 7 / eligibility 3 / activity 41.

**First run with packages must verify**
- `make gen-api` (web `schema.ts`: `nav_badges`, `paid_month_label` become required; `PracticeSettings*`, `PlanBenefits.deductible_met_on`), `make lint` (ruff/mypy were not runnable here), FastAPI contract tests (route table vs app incl. `PATCH /settings/practice`), `make eval` via typer.
- Web mock step 8 still composes 16 from Lindgren + a held ERA line; re-align to the API's 17 (ADR-0002) and the e2e expectation.
- Live mode against the real API: Castillo/Moreno have no cassette and replay as `scripted_fallback` (same shape); re-record cassettes with a key.

**Still open**
- No handlers for `visit.checked_out` (claim building), `eligibility.sweep`, posting on `era.arrived`, `claim.rejected`, `hold.escalate`, `prompt_pay.due`; overnight 835s stay `needs_review`.
