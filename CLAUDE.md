# Torch — agentic dental RCM demo

Torch is a believable, interactive demo of an agentic-AI revenue-cycle product for dental practices, built as a job-application project for a Senior Full-Stack (front-end leaning) role. The people who will evaluate it build this kind of software for a living and use Claude Code daily. Every shortcut must be invisible from the UI and defensible under questioning.

## Read these before changing anything

1. `docs/design/decisions-log.md` — what the product is and why (seven red-teamed design rounds).
2. `docs/spec/00-product.md` → `07-agents.md` — the contracts. The spec is the source of truth; if code and spec disagree, fix one and say which.
3. `docs/adr/` — architecture decisions. Add an ADR for anything you decide that a reviewer could reasonably have decided differently.
4. `docs/SESSIONS.md` — how work is split across parallel Claude Code sessions, and which model to use for what.
5. `docs/design/mocks.html` — the visual target. Open the "Overview" and "Engineering notes" sections; grep the rest.

## Repo layout

```text
apps/api/        FastAPI + SQLModel (SQLite) · torch/{domain,world,seed,agents,api,scheduler}
apps/web/        Vite + React 19 + TS · TanStack Router/Query/Table · Zod client generated from OpenAPI
packages/        (none yet; shared contracts live in the API's OpenAPI → web codegen)
docs/            spec/ (contracts) · adr/ · design/ (mocks, red-team reports, decisions log) · SESSIONS.md
infra/           docker-compose, Dockerfiles, deploy configs (Fly for api, Vercel for web — not deployed)
Makefile         make dev | seed | test | eval | gen-api | lint | e2e
```

## Commands

```bash
make dev          # api on :8000 (uv run uvicorn), web on :5173 (pnpm dev), seeds canonical scenario if DB missing
make seed         # reseed canonical scenario (destroys local DB)
make test         # pytest (api) + vitest (web)
make e2e          # playwright demo script against make dev
make eval         # replay canonical scenario through deterministic + live(cassette) modes; assert identical run shapes + invariants
make gen-api      # regenerate apps/web/src/api/* from /api/openapi.json — run after ANY API schema change
make lint         # ruff + mypy (api); eslint + tsc --noEmit (web)
```

Python: `uv` (3.13), `ruff`, `mypy --strict` on `torch/domain` and `torch/agents`. Web: `pnpm`, TypeScript strict, ESLint. Node 22.

## Hard rules (red-team findings turned into constraints)

- **One status model.** `ClaimStatus` has nine values; `needs_action` is a derived flag. Never store a count that can be derived; never render a number the server didn't compute. Strip tiles, badges, footers and KPIs come from `GET /summary/strip` and `meta.counts` on mutations.
- **Money is integer cents** server-side; format in the UI only. Every remittance line must satisfy `billed = paid + Σadj + patient` (test exists; keep it green).
- **Three tiers; the Policy layer is the only thing that decides whether an action runs.** The model proposes; code gates and executes. No mutating tool is ever exposed to the model. Tier 3 actions are human-only — there is no code path that automates them.
- **Observe mode does nothing** except record `would_have_run` runs. Payer contact (status checks, rep calls) is a rule-governed action, so Observe never talks to a payer.
- **Root cause `ours` can never be learned into auto-run.** The guard lives in `agents/policy.py` and is tested.
- **Agent-written payer- or patient-facing text is tier 2** and goes to the inbox as `review_draft` with segment-level evidence citations; the NEA# or an ICN pasted into a fixed field is not "written text".
- **World content is untrusted.** Portal pages, transcripts and notes are wrapped and labelled in prompts; the model is never instructed by them. The adversarial tests in `apps/api/tests/adversarial/` must pass.
- **Frozen, advanceable clock.** Nothing reads wall-clock time. `POST /clock/advance` is async (202) and drives the scheduler.
- **The demo is deterministic by default** (`TORCH_AGENT_MODE=deterministic`). Live mode (`live`, needs `ANTHROPIC_API_KEY`) must produce identically-shaped runs on the canonical cases; tests replay cassettes and never call the API.
- **Anthropic API usage (5.5 models):** no `temperature`/`top_p`/`top_k`; use the static capability table in `agents/llm/models.py`; automatic top-level prompt caching; strict tool schemas with no PHI in `enum`/`const`; a terminal tool sent alongside reads is rejected with `is_error`.
- **No real vendor names** except payers (Delta Dental of NY, MetLife, Cigna, Aetna, Guardian, NY Medicaid), Vyne and NEA. The PMS is "the PMS". Patients and staff are invented.
- **No dead links.** Interactive screens do the thing; static screens read seed data; mock-only routes render `MockOnlyBanner` + the design.
- **URL is the source of truth for filters, sort, selection and tabs** (`validateSearch` with Zod). Query cache holds server data. Counts are selectors, never state.

## Working style

- Plan in `docs/plans/<topic>.md` before a multi-file change; keep it short; delete it when merged.
- Small commits with conventional messages (`feat(api): …`, `feat(web): …`, `docs: …`). Never commit `.env`, `*.db`, cassettes containing real keys.
- Tests are part of the feature. A feature without its invariant test is not done.
- When unsure about a product or architecture decision, do not ask the user: write the options in a plan, run `/challenge --red-team` on your lean with a domain persona (see `docs/SESSIONS.md` → "Deciding without the user"), adopt the result, record an ADR.
- Before ending a session: `make lint test` green, `docs/STATUS.md` updated (what's done, what's next, what's blocked), and the task list current.

## Status

See `docs/STATUS.md`.
