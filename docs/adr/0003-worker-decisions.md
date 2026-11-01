# ADR-0003 — Decisions made by build workers (S1/S2), kept as records

Status: accepted · 2026-11-01

Each parallel worker recorded its judgment calls in a plan file while building. Those files are kept verbatim under `docs/adr/worker-notes/` (they are historical, not live plans). The decisions that outlive the build:

- **Storage is a pydantic document store on SQLite**, not SQLModel tables (api-core D1). One model set serves OpenAPI and storage; swap for Postgres JSONB + an outbox in production.
- **Scheduler lives in `torch_rcm/scheduler/`** with a handler registry the agents register into; job kinds without a handler are reported `skipped_unhandled`, so the world runs without agents.
- **The world moves claim status on an 835**; posting is the agents' job and is tracked on `Remittance.status`.
- **Approve creates the queued Run** (`approval:{item}`) and enqueues `run.start`; the agents package registers nothing on import so the registry stays world-only in contract tests.
- **Agents package ports** (`ports.py`): World/Domain/Scheduler/Clock Protocols; slot-only templates (no Jinja — a template cannot invent facts); cassettes under `apps/api/cassettes/` with `synthetic: true` until recorded.
- **Web: URL holds filters/selection/tabs; counts are selectors**; the MSW mock layer (`src/mocks/db.ts`) mirrors the API's read models and is re-baselined from API dumps, never the other way round; e2e defaults to mocks and runs against the real API with `E2E_TARGET=real`.
- **Settings is reachable by billing**; only tier-2 sign-off needs the owner (05-frontend updated).
- **Numbers are computed, never invented**: when the API's Thursday inbox came to 17 instead of the mocks' 16, the mocks and e2e were re-baselined (ADR-0002).

Spec deviations each worker flagged were reconciled into `docs/spec/*` by the integration pass; the specs are the source of truth again.
