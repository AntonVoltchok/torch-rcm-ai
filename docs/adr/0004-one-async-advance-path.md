# ADR-0004 — One async advance path; failure is a terminal event

Status: accepted · 2026-11-02

## Context

First run failed `POST /clock/advance?wait=true`. The server's response was self-consistent: it sent `200 AdvanceOut`, and the smoke test validated that against the contract table's `AdvanceAccepted`. The defect was that the flag existed at all. `docs/spec/02-api.md` and the hard rule in `CLAUDE.md` both give one shape, async `202`. Its docstrings claimed "CLI, tests, e2e", but only tests used it, and the path the demo uses had never been run to completion over HTTP.

## Decision

Remove `?wait=true` (red team: hiring Director of Engineering, `docs/design/red-team/challenge-advance-wait-2026-11-02.md`). The one reason that carried: the spec and the hard rule allow one shape, and removal is only honest once the async path reports failure, which it did not.

So the removal comes with:

- The route uses `response_model=AdvanceAccepted`, so the 202 is server-validated.
- A failed advance publishes its terminal `advance` event with `done: true`, `state: "failed"` and `error`. Before, it was stored but never published, and a client on the firehose stopped polling and waited forever. This is the one spec edit: an additive clause on the event. The web's `AdvanceSnapshot` already accepts both fields and its failure toast already reads them, so no web change follows.
- A cancelled advance is recorded as failed, and boot fails any advance still `running`. `begin_advance` treats that row as the lock, so a restart mid-advance used to mean `409` on every advance until a reset. Jobs were already recovered; advances were not.
- Tests take the real path with no polling and no wall-clock deadline: 202, await `scheduler.wait` through the TestClient portal, then one `GET`, asserting `state`, not just `done`, which is also true of a failure. The fixture awaits the task at teardown. A gated test proves the 202 returns before the work.

## Rejected

- **Keep and document:** the only option that edits the source of truth, carving an exception into a hard rule for a test convenience. In live mode it also holds a request open for minutes.
- **Keep but hide (`include_in_schema=False`):** behaviour no document mentions.
- **`await asyncio.sleep(0)` after each handler (red-team suggestion):** not needed. Measured over one canonical advance, the loop ticked 1.3M times with a longest gap of 0.1s, so handlers already yield and SSE progress is not starved.

## Related first-run corrections

- **The contract check reads the OpenAPI document,** not `app.routes`: FastAPI 0.162 wraps included routers in opaque objects, so the old set comprehension produced an empty set. It now compares every operation (status, response model, body and whether it is optional, query and header params, `Idempotency-Key`, SSE media type) and pins the snapshot to the app's document. Operation tags are not compared: they are docs grouping, and four differ (`claims` plus `summary`, `views` or `ledger`).
- **`RunStore.list` became `find`:** in a class body the method shadows the builtin in later annotations. `find` is the store's own word.
- **`apps/api/.python-version` pins 3.13:** `requires-python = ">=3.13"` let `uv` pick 3.15 on a machine with no 3.13, which is not what CI or `CLAUDE.md` run.
