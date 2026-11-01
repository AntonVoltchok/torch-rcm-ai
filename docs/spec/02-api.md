# API surface (FastAPI, `/api/v1`)

JSON over HTTP; SSE for run progress. All list endpoints accept `?location_id` and return `{items, total, next_cursor?}`. Errors are `{error: {code, message, details?}}` with the codes listed per endpoint. Auth is a demo header `X-Torch-User: usr_dana` (role resolved server-side); the web app has a user switcher in the sidebar footer. Every mutation writes an `AuditEvent` and returns the **updated derived counts** in `meta.counts` so the client can patch its caches without a second round trip.

## Clock

The demo runs on a **frozen, advanceable clock** (default Wed 2026-10-28 10:40 America/New_York). Everything that would be "now" reads `clock.now()`.

- `GET /clock` → `{now, frozen: true, advancing?: {advance_id, to}}`
- `POST /clock/advance {minutes | to}` → **async**: `202 {advance_id, from, to}`. A background task runs the scheduler for the interval (files leave, acks arrive, status checks fire, ERAs arrive, holds age), one due job at a time, draining the agent runs each job spawns before the next (causal barrier). Progress is published on `GET /runs/stream` as `event: advance` `{advance_id, now, events_fired, runs_started, live_runs, done}` after every handler; the last one has `done: true` and the full `events_fired[]`. Errors: `409 advance_in_progress`. Live mode: at most 2 concurrent model calls and `TORCH_ADVANCE_LIVE_RUN_CAP` (default 8) live runs per advance; runs beyond the cap use the scripted planner, labeled. Approvals made during an advance are accepted; their runs queue until it finishes. Owner-only in the UI (a "⏭ Skip to tomorrow 7:10 AM" control in the sidebar footer, demo-only), which shows progress until `done`.
- `GET /clock/advance/{advance_id}` → the latest `advance` snapshot (polling fallback when SSE is blocked).
- `POST /clock/reset` → re-seeds the database to the canonical state.

## Inbox

- `GET /inbox?state=open|snoozed|done&kind&agent&group=true` → items; with `group=true` returns `groups[] {group_key, title, count, cents, item_ids}` plus ungrouped items.
- `GET /inbox/{id}` → item with evidence hydrated and the referenced claim summary.
- `POST /inbox/{id}:approve {edits?}` → `{item, run}`; starts a Run (202). Errors: `409 file_departed` (hold window closed → response includes `alternatives: ["corrected_claim"]`), `409 already_resolved`, `403 tier_requires_owner`.
- `POST /inbox:approve-group {group_key}` → `{items[], runs[]}`.
- `POST /inbox/{id}:reject {reason}` · `POST /inbox/{id}:snooze {until}` · `POST /inbox/{id}:reopen`
- `POST /inbox/{id}:always-auto-run` → creates a `RuleProposal` (tier 1 only; `root_cause=ours` → `422 root_cause_guard`).

## Claims

- `GET /claims?status[]&needs_action&payer&provider&age_bucket&q&sort&cursor&limit` (server-side filter/sort; the web puts all of these in search params).
- `GET /claims/{id}` → claim + lines + attachments + acks + readiness + timeline (merged Runs/RunSteps/AuditEvents/AckEvents/human actions, newest last) + `open_inbox_items[]`.
- `GET /claims/{id}/timeline?cursor` (same as above, paged).
- `POST /claims/{id}:void` (tier 3; owner) · `POST /claims/{id}:corrected {changes}` (tier 2).
- `GET /summary/strip` → `[{status, count, cents, flagged}]` + `{inbox_open, paid_month_cents, paid_month_count, paid_month_label}` + `nav_badges {payments, eligibility, activity}` (remittances not auto-posted · open eligibility flags the viewer sees · this week's decisions that ran without review). Sidebar badges read only these.
- `GET /views` / `POST /views {name, search_params}` → saved views (server).

## Today's claims (ledger)

- `GET /ledger/today` → `{sent[], leaving_next_file[] (with file_time, editable_until), held[] (reason, held_since, timely_due, owner), not_billable[]}`.

## Runs (agents)

- `GET /runs?agent&status&since` · `GET /runs/{id}` → steps, evidence, audit_line.
- `GET /runs/{id}/events` → **SSE**: `event: step` `{idx, name, phase (started|progress|completed|failed), status, output_summary, progress_line?, evidence?}` (`progress` lines carry the reads a live model chose inside `investigate`), `event: status` `{status}` (includes `paused`), `event: counts` `{...}`, `event: done`. Honors `Last-Event-ID` for reconnect; the server replays missed events from the stored `run_events` log.
- `GET /runs/stream` → SSE firehose of all run status changes (sidebar "5 agents active") plus `event: advance` (see Clock) and `event: agents` `{paused, by, at}`.
- `POST /runs/{id}:cancel` (only while `queued`).

## Agents (runtime control)

- `GET /agents/status` → `{paused, paused_by?, paused_at?, mode: deterministic|live, live_agents[], running, queued, paused_runs}`.
- `POST /agents:pause` (owner) → sets `practice.agents_paused`; queued agent jobs are parked (not re-polled), running runs stop at the next step boundary with status `paused`; the simulated world keeps running. Writes an AuditEvent. `403` for non-owners.
- `POST /agents:resume` (owner) → re-queues parked jobs; paused runs continue from their last completed step.
- `POST /claims/{id}:triage {agent?: claims|followup}` → `202 {run}`: starts a manual triage run (trigger `manual`, actor = caller) on the claim; defaults to the agent the Router assigns. Errors: `409 run_in_progress` (a run on this claim is queued/running), `409 agents_paused`.

## Settings › Agents

- `GET /rules` → tiers with rows, `base_rate`, `ran_without_review_7d`, change log pointer.
- `PATCH /rules/{id} {mode | max_cents | confidence_floor}` → `409 owner_signoff_required` creates an `owner_signoff` InboxItem for Dr. Morgan instead; tier 3 → `403 human_only`.
- `GET /rules/changes` · `GET /settings/preview?rule_id&mode&max_cents` → `{would_run, total, baseline_would_run, held_by_root_cause}` over this week's decisions (seeded triage runs, including those whose items Dana since approved; approval runs are not counted twice). `would_run` is net of the root-cause guard: the UI shows `baseline_would_run → would_run + Σheld` and "N held (root cause: ours) · net `would_run`".
- `PATCH /settings/practice {practice_cap_cents}` → `{practice_cap_cents, meta}`: the practice-wide tier-2 cap (tier 1 is exempt); owner only (`403 owner_only`), `422 invalid_cap` outside $0–$25,000; writes an audit event.
- `GET /proposals` · `POST /proposals/{id}:accept|dismiss` (`422 root_cause_guard`).

## Static-screen reads

- `GET /activity?day&agent&outcome` → run log rows including `would_have_run`.
- `GET /eligibility?date` → appointments with status; `GET /eligibility/{appointment_id}` → benefits panel.
- `GET /cash?location_id` → KPIs `{value, formula, basis}`, aging, by payer, by provider, write-offs by type, agent impact `{items_auto, hours_saved_est {value, basis}}`.
- `GET /denials` → worklist grouped by next action (reconsideration | corrected | formal_appeal | bill_patient_link | write_off).
- `GET /remittances` / `GET /remittances/{id}` · `GET /patients/balances` (read-only in demo).

## Mock world (demo admin, hidden behind `/api/v1/_world`)

- `POST /_world/reseed {scenario?}` · `GET /_world/payers` (rules) · `POST /_world/inject {event}` (e.g. force a Vyne 277CA A7 on a claim) — used by the demo script and tests.

## Conventions

- OpenAPI at `/api/openapi.json`; `pnpm gen:api` regenerates Zod + typed client.
- Idempotency: mutations accept `Idempotency-Key`; the approve endpoints are idempotent per item.
- All timestamps ISO-8601 with offset; the server never uses wall-clock time.
