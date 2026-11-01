# The mock world (what the agents act on)

Agents never call the internet. They call **tools** whose implementations are simulated systems with realistic shapes and payer-specific behavior. The simulation is deterministic given the seed and the clock, so the demo is repeatable; a small amount of seeded randomness (PRNG keyed by claim id) decides ack timing and denial draws so it doesn't look scripted.

Package: `apps/api/torch/world/`. Every simulated system exposes a Python interface **and** records every call in `WorldCallLog` (the basis for Evidence objects and the "what the agent did" story).

## Clock and scheduler

- `Clock` is injectable; `advance(delta)` emits a `Tick` and the scheduler runs due jobs in order: file departures → clearinghouse acks → payer acks → payer adjudication (835 generation) → status-check schedules → hold aging → statement/true-up windows.
- Business hours matter: files leave at payer `file_times`; payer acks arrive next business morning 06:00–08:00; 835s arrive on payer-specific weekdays (Delta Tue/Thu, Cigna Mon/Wed/Fri, etc.).

## PMS (`PmsAdapter`)

Simulates the practice-management system: patients, coverages, appointments, completed visits with procedure lines, signed notes, imaging (with the realistic flaw that an image may exist but be the wrong type), fee schedules per payer (contract **allowed** amounts), ledger posting. Sync is "4 min ago" by default. Tools: `pms.get_visit`, `pms.get_coverage`, `pms.find_images(patient, dos, kinds)`, `pms.get_fee_schedule(payer)`, `pms.post_payment`, `pms.update_benefits` (tier 2), `pms.get_note(visit)`.

## Clearinghouse (`VyneSim`)

`submit_file(claims[])` → `999` (file-level) accept/reject within minutes; `277CA` per claim: A1 accept (forward to payer) or A7 reject with a code (`A7:164` invalid subscriber id, `A7:145` missing provider id, `A7:85` invalid tooth). Rejection rate per seed ~3%, concentrated on claims flagged `subscriber_id_format: warn`. Status inquiry `276/277` returns payer-side status for accepted claims. Attachments go through `NeaSim.upload(kind) → NEA#`.

## Payers (`PayerSim` per PayerKey) — the realism lives here

Each payer has: payer_id, timely filing, appeal windows and levels, file_times, prompt-pay basis, adjudication latency (business days, drawn from a range), and **rules**:

| Payer | Signature behaviors |
|---|---|
| **Delta Dental of NY** (payer 11198, PPO) | Requires PA (periapical) on D27xx crowns; frequency: crowns 1/60 mo per tooth using *payer* tooth history (which may differ from the PMS → CO-119); D4341 requires perio chart + narrative; pays 50% major, 80% basic, 100% preventive after $50 deductible; annual max $1,500 typical; 835 Tue/Thu; latency 12–20 bd |
| **MetLife** (PPO) | Subscriber id is 9 digits (A7:164 if not); prompt-pay reprocessing requests honored; secondary COB pays 50% after deductible on primary's allowed; latency 15–30 bd |
| **Cigna** (PPO) | Posting quirk: occasionally applies PR-1 deductible though met (the Foster case) → variance, not write-off; alternate benefit: D2392 → D2140 amalgam rate; latency 10–18 bd |
| **Aetna** (ASO / self-funded) | Alternate benefit downgrades on posterior composites (patient may be billed the difference; must be on the estimate); ERISA appeal rules (180 d, 2 levels, patient authorization for provider appeals); latency 14–25 bd |
| **Guardian** (TPA, self-funded) | SRP criteria: ≥4 teeth per quadrant with ≥4 mm pockets (CO-50·N10 if chart doesn't show it); paper checks sometimes (needs deposit); sends 835 only on request for small EFTs; latency 20–35 bd |
| **NY Medicaid** | Cannot be balance-billed; non-covered only with dated written consent; 60-day appeal window |

Adjudication (`adjudicate(claim) → Remittance lines`): compute allowed from the payer fee schedule; apply deductible/percentage/annual max remaining/frequency/alternate benefit/attachment rules → paid, CO-45 contractual, PR-1/PR-2/PR-3 patient amounts, or a denial with **CARC·RARC pair** (`CO-16·N29` missing attachment, `CO-16·M127` records request, `CO-119`/`PR-119` max or frequency, `CO-197` pre-auth (only payers that require it), `CO-204` not covered, `CO-22` COB, `CO-29` timely, `CO-50·N10` not medically necessary, `OA-23` secondary). Every line must satisfy `billed = paid + Σadj + patient`.

Portal / IVR / rep call (`PayerContact`): `check_status(icn)` returns IVR-style status text and a reference; `call_rep(topic)` returns a transcript excerpt and a call reference `DD-1027-88412` style, bounded by what the agent may agree to (reprocessing requests yes; refunds/offsets no). Portals go "down" on a seeded schedule (~2%) → agents retry later and say so.

## Scenarios (`world/scenarios/`)

`canonical` is the reconciled state the mocks were drawn from (see `04-seed.md`). Additional scenarios for tests/demo: `empty_inbox`, `portal_outage`, `observe_mode_day3`, `dso_4000_claims` (volume for table performance).

## Evidence generation

Every world call produces an `Evidence` candidate: portal "screenshot" = a rendered HTML snippet of the simulated portal status page (served as an image-like card), IVR transcript = text with timestamps, ERA line = the structured line, PMS record = the record snapshot. Nothing is a placeholder image.
