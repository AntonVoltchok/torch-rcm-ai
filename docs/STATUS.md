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
