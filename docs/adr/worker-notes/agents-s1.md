# Agents — judgment calls made while building `torch_rcm/agents` (S1)

Each entry: question · options · lean → decision. All decisions follow 07-agents.md and ADR-0001 unless noted.

## 1. Where the agents package meets the rest of the app
- A. Import `torch_rcm.domain` / `torch_rcm.world` / `torch_rcm.scheduler` directly. B. Code against narrow Protocols (`torch_rcm/agents/ports.py`) and let the coordinator supply adapters.
- **Decision: B.** The parallel api worker had not published those modules when this package was built, and the agents package must not depend on SQLModel table shapes it does not own. `ports.py` has four ports: `WorldPort` (read/act with WorldCallLog semantics), `DomainPort` (case views, rules, inbox, holds, practice pause), `SchedulerPort` (enqueue/park/unpark) and `Clock`. `torch_rcm/agents/testing/` carries an in-memory `FixtureWorld` implementing World+Domain for the pinned cases, so tests and `torch eval` run with no other package.

## 2. Run persistence
- A. Write Run/RunStep/Evidence through `torch_rcm.domain` SQLModel tables. B. Agents own their run tables in the same SQLite file through the stdlib `sqlite3` driver behind `db.py`'s single writer.
- **Decision: B** (`runstore.py`). Tables: `runs, run_steps, run_events, evidence, llm_calls, run_checkpoints, action_log`. Column names follow 01-domain-model, so the API's `GET /runs/{id}` can read them directly or through `RunStore.get()`. If the api worker also defines `runs`, the coordinator picks one owner (lean: agents own run tables; domain reads them).

## 3. Layout vs §10
- §10 says `executor.py`, `definitions/`, `llm/profiles.py`, `eval/__main__.py`; the brief/CLAUDE.md say `executor/`, `llm/models.py`, `eval.py`, `runtime.py`, `api_hooks.py`.
- **Decision:** `executor/` package (recipes + pipeline + audit are separate modules), `definitions/` for the five agents (§10; avoids `torch_rcm/agents/agents`), `llm/models.py` (CLAUDE.md hard rule names it), `eval.py` + `python -m torch_rcm.agents.eval`, `runtime.py` for job handlers / advance drain / pause / recovery, `runstore.py` + `events.py` as §10.

## 4. Templates
- A. Jinja (`.j2`, spec §4). B. stdlib `string.Template` (`.tmpl`), logic-free.
- **Decision: B.** Jinja is not a declared dependency; slot-only templates are what §4 asks for ("slots filled only from CaseFile and evidence") and a template cannot branch or loop, so it cannot invent facts. Missing slots raise.

## 5. Config
- `AgentConfig` is a Pydantic model with `from_env()` instead of `pydantic_settings.BaseSettings` (same env names, same defaults). Reason: pydantic-settings was not installable in this sandbox; behaviour is identical and the class is smaller. Swap is one line if the coordinator prefers BaseSettings.
- `TORCH_STEP_DELAY_SCALE` (float, default 1.0) added next to `TORCH_STEP_DELAY` (bool): the brief asks for scaling; scale 0 == off.

## 6. Cassettes location and synthetic recordings
- Spec: `tests/cassettes/<scenario>/...`; brief: `apps/api/cassettes/`. **Decision:** `apps/api/cassettes/<scenario>/<agent>/<situation>/<subject>.jsonl` (`:` in situation keys becomes `_`). `TORCH_CASSETTE_DIR` default `cassettes`.
- No API key here, so canonical cassettes are produced by `torch cassette record --synthetic`: the real LivePlanner/LlmClient/request builder run end to end, but the transport answers from hand-authored model turns (`cassettes/synthetic_turns/*.json`). The header line says `"synthetic": true`. `make record` with a key re-records through `HttpTransport`; nothing else changes. No thinking blocks are fabricated (no fake signatures).

## 7. Policy table additions
- "A proposal citing only `suspicious` evidence never executes" (§5.5) is folded into **row 5** (propose; reason "cites only suspicious evidence"), so the table keeps its 16 rows.
- Approval runs re-check rows 0, 1, 3, 7, 14 (§5.1; row 7 added in the review fix pass); a tier-3 approval by an actor without the role is a row-1 refusal ("actor lacks role").
- Rule matching ignores `max_cents` as a filter and uses it only for specificity + row 11 (otherwise an over-cap claim would fall to a less specific rule and could auto-run).

## 8. Seed discrepancies noticed (for the seed worker / coordinator)
- Owens tooth: 04-seed says D2740 **#30**; mocks show **#19**. Fixture uses #30 (spec wins).
- Delta group mates (from mocks): `clm_4836` L. Grant D2750 #3 $1,180 and `clm_4840` F. Diaz D2740 #14 $1,310 → group $3,730. Mocks show per-item confidence 92/95/93 %; §2 says confidence is the rule's base rate, so all three show 92 % (23/25). Recommend the mocks' per-item numbers be dropped.
- Castillo: mocks say root cause ours ("we sent the 04/2025 chart"); 04-seed doesn't say. Fixture uses `ours` → proposed, not executed.
