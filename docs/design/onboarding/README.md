# Onboarding tour mock

An interactive mock of TorchRCM's in-app onboarding: one main tour that follows K. Owens #4821 through the whole loop, and a tour for every screen in `nav.ts`. Every step has a code pane, open by default, with the payload behind what the step shows.

- **Artifact:** https://claude.ai/artifact/3ErpLqW7EYjSrruLu4HMKi (private to the owner until shared). The first mock, built against the pre-D1 shell, was https://claude.ai/artifact/HGxQ54p4RSmwsYRHdc6fh8.
- **Open locally:** `tour-mock.html` (one self-contained file; it loads only the Geist font from Google Fonts).
- **Decisions to review:** [DECISIONS.md](DECISIONS.md). The red-team report they came from is [red-team.md](red-team.md).

## What is real

| In the mock | Where it came from |
|---|---|
| Every screen | The real app's rendered DOM (`#root` innerHTML) and its compiled stylesheet, captured with Playwright at 1440×900 from `make dev` at the commit in the header. Not drawn by hand. |
| State changes (Approve 3, Ask Follow-up to look, Skip to Thu 7:10, the preview hover, Accept, the 409) | Snapshots taken after doing the real thing in the real UI, in the demo script's order. The run panes reveal their captured steps one at a time. |
| "captured" code panes | API responses from the running app (`GET`s and the mutation responses), trimmed with `# … N more` where a list is long. |
| "rendered on the seed" panes | The real code run on the canonical seed: `render_case`, `ScriptedPlanner.plan`, `decide()`, the tool schemas, `wording` outputs. |
| "verbatim source" panes | Excerpts of `prompts/followup.md`, `policy.py`, `learning.py`, `recipes.py`, `llm/models.py`, `MockOnlyBanner.tsx`, `search.ts`. |
| "hand-authored recording" | The #4744 cassette and recorded plan. The repo marks the cassette `synthetic: true`; the mock says so wherever it appears. |
| Payments and Patients | The design frame the app's `MockOnlyBanner` shows, screenshotted inside the app. |
| The "Tour this screen" button in the sidebar | **Proposed, not in the app.** It is drawn into the snapshot where the shipped control would sit and is labelled "proposed". |

`capture/build.py` asserts every number the step copy states against the captured JSON (30 checks, including "every Wednesday snapshot's Inbox badge reads 11"). The build fails if one drifts.

## Regenerate

You need the app's dependencies installed (`uv sync` in `apps/api`, `pnpm install` in `apps/web`) and an isolated API and web, so the captures do not touch anyone's working database:

```bash
CAP=/tmp/torch-tour            # any scratch directory
mkdir -p $CAP/cap/png $CAP/cap/dom $CAP/payloads/raw $CAP/payloads/model
# API on :8100 with its own DB, web on :5180 pointed at it
(cd apps/api && TORCH_DB_URL=sqlite:///$CAP/torch.db TORCH_CORS_ORIGINS='["http://localhost:5180"]' uv run torch seed --force && \
  TORCH_DB_URL=sqlite:///$CAP/torch.db TORCH_CORS_ORIGINS='["http://localhost:5180"]' uv run uvicorn torch_rcm.api.app:app --port 8100) &
(cd apps/web && VITE_API_BASE=http://localhost:8100/api/v1 pnpm exec vite --port 5180 --strictPort) &
```

Then, from the repo root, with the seed fresh (`POST /api/v1/_world/reseed` as `usr_morgan` between phases):

1. **Wednesday screens.** `OUT=$CAP/cap node docs/design/onboarding/capture/snap.cjs '<jobs>'`, where jobs is a JSON list of `{label, user, path}`; the first job sets `"css": true` to save the stylesheet. The labels the mock uses are the keys of `META` in `tour-src.html`. Also `OUT=$CAP/cap node capture/design.cjs` for the two design frames.
2. **Wednesday API.** `RAW=$CAP/payloads/raw python3 docs/design/onboarding/capture/get.py wed`, then the extra reads the panes use:
   `RAW=$CAP/payloads/raw python3 docs/design/onboarding/capture/get.py x 'benefits_chen|/eligibility/apt_1029_chen_j|usr_dana' 'remittance_delta|/remittances/rem_delta_1026|usr_dana' 'preview_status_auto|/settings/preview?rule_id=rule_t1_status_check&mode=auto|usr_dana' 'preview_delta_ask|/settings/preview?rule_id=rule_t1_delta_pa&mode=ask|usr_dana'`.
3. **The demo, in order.** `OUT=$CAP/cap RAW=$CAP/payloads/raw node docs/design/onboarding/capture/mutate.cjs` runs steps 3, 3b, 6, 7 and 8 through the real UI and saves the mutation responses. Fetch the run events with `curl -N --max-time 4 localhost:8100/api/v1/runs/<run_id>/events > $CAP/payloads/raw/events_<run_id>.txt`, then `get.py after` with `strip_thu`, `inbox_thu`, `advance_status` (`/clock/advance/<id>`), `cash_thu`, `activity_thu`, `denials_thu`, `claim_4821_thu` and `changes_after` (the names `build.py` reads). Reseed and run `PHASE=triage` and `PHASE=settings` so the claim-detail and Settings tours start from Wednesday's numbers.
4. **Model-facing payloads.** `cd apps/api && MODEL_OUT=$CAP/payloads/model uv run python ../../docs/design/onboarding/capture/model/gen.py` (and `cases.py`, `tools.py`, then `assemble.py`). Seed a throwaway `$CAP/payloads/model/seed.db` first; `common.py` copies it per run.
5. **Build.** `python3 docs/design/onboarding/capture/build.py $CAP $(git rev-parse --short HEAD)` writes `tour-mock.html`.

Edit `tour-src.html` (engine and step copy) and `capture/build.py` (code panes and checks); never edit `tour-mock.html` by hand.
