# Torch — agentic RCM for dental practices (interactive demo)

Torch is a demo of a revenue-cycle-management product where AI agents do the insurance back-and-forth for a dental practice — verifying benefits, building and sending claims, chasing payers, working denials, posting remittances — and the billing coordinator supervises through an inbox of decisions. The practice owner sets, in a readable rules table, exactly what the agents may do without a person.

It was designed in seven rounds of mocks, each attacked by an independent red team playing a dental billing lead, a practice owner, an appeals specialist and a hiring engineering director; the design decisions and every red-team report are in `docs/design/`. The build follows the same discipline: when a decision needs judgment, it is red-teamed and recorded as an ADR instead of guessed.

## Run it

```bash
cp .env.example .env            # deterministic mode works with no API key
make dev                        # api :8000 · web :5173 · seeds the canonical practice
# or
docker compose -f infra/docker-compose.yml up
```

Open http://localhost:5173 as Dana (billing coordinator). The ten-minute demo script is in `docs/spec/06-demo-script.md`; the sidebar footer has a user switcher and a demo clock ("Skip to tomorrow 7:10 AM") that advances the simulated world.

Set `TORCH_AGENT_MODE=live` and `ANTHROPIC_API_KEY` to have Claude triage ambiguous claims and draft appeal text. Tiers and guardrails are the same code in both modes. Run shapes are compared by `make eval` against hand-authored cassettes; live mode has not yet been run against the real API.

## What's real, what's static, what's design-only

| Interactive | Static (seed data) | Design only |
|---|---|---|
| Inbox · Claim detail · Claims table · Settings › Agents · agent runs (streamed) | Today's claims · Activity · Eligibility · Cash · Denials worklist | Appeal workbench · Payments posting · Patient checkout & balances |

## Architecture in one paragraph

FastAPI over a pydantic document store in SQLite serves a frozen, advanceable clock over a simulated world (PMS, clearinghouse, five payers with their real quirks). Agents never touch the internet: in `live` mode a Claude model reads world content through tools, classifies the situation and **proposes** an allowed action with evidence; a Policy layer (rules table × autonomy tier × caps × root cause) decides whether it runs, goes to the inbox, is only observed, or is refused; an Executor runs each action as a fixed, idempotent, code-defined recipe and streams steps over SSE. `deterministic` mode satisfies the same planner interface with scripted policies, so tests and the demo never depend on the API. The web app is a React/TypeScript SPA on TanStack Router (filters, selection and tabs live in the URL) and TanStack Query (all server data; counts are selectors, never state), with Zod schemas generated from the API's OpenAPI (`make gen-api`). `pnpm test:contract` parses real API responses and stream frames with them, so a mock that drifts cannot hide a mismatch.

Docs: `docs/spec/` (contracts) · `docs/adr/` · `docs/SESSIONS.md` (how the build is parallelized across Claude Code sessions) · `docs/STATUS.md`.

## Not built in this demo (by design)

- Scheduler handlers for `visit.checked_out` (claims are seeded as built), `eligibility.sweep`, `claim.rejected`, `hold.escalate`, `prompt_pay.due`; posting runs on `era.arrived` (overnight 835s stay in "needs review").
- Live-mode cassettes are hand-authored (`synthetic: true`) until `torch cassette record` is run with an API key.
- Real EDI, payer portals, PMS integration, auth, HIPAA controls, payment processing.

## How this was built

Designed over seven red-teamed mock rounds, then built in parallel Claude Code sessions coordinated by one session that made decisions by red team instead of guessing (`docs/SESSIONS.md`). The first build pass ran with no PyPI or npm access; the first real run on a laptop is recorded in `docs/STATUS.md`, with the bugs only that run could find and what is still unverified. `make e2e` runs against MSW and CI does not run e2e; the demo script against the real API is a local step (`E2E_TARGET=real pnpm e2e --grep @demo` with `make dev` running).
