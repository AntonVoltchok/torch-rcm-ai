# Seed data (canonical scenario)

The generator (`apps/api/torch_rcm/seed/`) builds the whole practice from a PRNG with a fixed seed, then **pins** the ~40 named records the demo script and the mocks reference so they come out exactly as designed. Everything else is generated to make the totals below true. A test asserts the reconciled numbers after seeding.

## Frozen clock

Wed 2026-10-28 10:40 America/New_York. (Denials screens in the mocks are Thu 10/29 07:10 — reachable via `POST /clock/advance`.)

## Reconciled numbers at 10:40 (must hold after seed)

| What | Value | Composition |
|---|---|---|
| Insurance A/R | 101 claims · $75,500 | sent 5 · $1,320 · rejected 2 · $830 · accepted 24 · $17,640 · pending 57 · $46,520 · denied 5 · $6,210 · appealed 3 · $1,920 · partial 5 · $1,060 |
| Open claims | 107 · $78,710 | A/R + ready 6 · $3,210 |
| Flagged (`needs_action`) claims | 9 · $8,265 billed | 5 denied, 1 pending, 1 rejected, 1 partial, 1 paid |
| Inbox open | 12 items · $9,697 | 9 claim items + 3 eligibility items |
| Decisions this week | 53 | 41 ran without review + 12 to Dana; by agent (ran/to-Dana): eligibility 5/3, claims 13/1, followup 18/4, appeals 0/1, posting 5/3; by tier: t1 29/5, t2 12/3, t3 0/1, no-rule 0/3 |
| Paid · Oct | 118 claims · $61,300 insurance | + patient $25,640 = $86,940 collections vs net production $91,200 (gross $112,600, contractual write-offs $21,400, non-contractual $876) |
| A/R aging | $46,420 / $15,890 / $7,074 / $6,116 | 0–30 / 31–60 / 61–90 / 90+ (8.1%) |
| A/R by payer | Delta $28,940 · MetLife $16,210 · Cigna $12,480 · Aetna $10,370 · Guardian $7,500 | |
| Patient A/R | $33,100 · credits $2,180 | aged from DOS |
| Days in A/R | 27 | ($75,500 + $33,100) ÷ $4,020/day |
| Appeal history (12 mo) | 6 of 9 won | reconsiderations 5/6, formal 1/3 |

Practice size: ~600 active patients, 2 locations, providers Dr. Morgan, Dr. Lee, hygienists RDH M. Cole + 1; 90 days of visits (~8–12/day/location); ~400 claims total in the window including paid ones.

## Pinned records (ids are stable; see `docs/design/mocks.html` for every detail)

**Claims**
- `clm_4821` K. Owens · Delta · DOS 10/12 · D2740 #19 $1,090 + D2950 $120 + D0220 $30 = $1,240 · allowed $986 · built at checkout 10/12 10:43, left in 10:45 file · payer 277CA A1 10/13, ICN `26299-041833` · **denied 10/26 CO-16·N29** (PA missing: our claims agent attached a BWX instead of the PA — `root_cause=ours`) · rule update 10/26 "Delta D27xx → attach PA, not BWX" by Dana surfaced 2 more → group of 3 · open inbox item: attach PA (NEA#) and resubmit in the 11:15 file · confidence 92% (23/25 paid) · status-check day 30 scheduled 11/11
- `clm_4733` J. Webb · Delta · D2740 #30 · **CO-119** frequency (Delta's tooth history has a 2022 crown on #30 that was really #31; real prior #30 crown seated 2019-08-14, replaced for fracture) → reconsideration: claim inquiry with Delta's own 03/2022 EOB (tier 1)
- `clm_4611` R. Diaz · Delta · D2740 · **PR-119** annual max met → bill patient allowed $1,012, write off $228 (closes in Payments)
- `clm_4705` T. Brooks · MetLife · pending 64 d → NY prompt-pay reprocessing request
- `clm_4748` · Aetna · D2392 → alternate benefit D2150 (`PR-186`, −$38) · billed $255
- `clm_4790` M. Duarte · Cigna · D2392 alternate benefit — not appealable; bill patient difference
- `clm_4772` Foster · Cigna · line underpaid $32: **PR-1 deductible applied though met 05/12** → variance held for reprocessing, NOT write-off; patient owes $27.20, $32 disputed, refund $6.40 owed
- `clm_4776` W. Abara · D4341 UR · Cigna secondary to MetLife (MetLife 50% after $50 deductible = $82.80; OA-23; Cigna paid $131.20; patient $0)
- `clm_4796` L. Ito · Guardian · D4341 UR+UL · DOS 10/09 · **CO-50·N10** after consultant review · self-funded ERISA group 00512 · Dr. Lee rendering → formal appeal (tier 3, Dr. Lee signs, patient authorization required)
- `clm_4797` Castillo · Guardian · **CO-16·M127** records request → send 10/09 chart + FMX via NEA (tier 1); outcome: new 835 line with SVC06
- `clm_3561` Morris · MetLife · **CO-29** timely filing → timely-filing appeal with 11/2025 payer 277CA as proof of receipt; if upheld → non-contractual write-off, patient cannot be billed
- `clm_4800` Moreno · **CO-22** COB → COB resubmit; coverage order changes in PMS → tier 2 → no rule → Dana
- Kaur: corrected claim (tier 2) · Partial
- **Seeded `unknown` situations** (classifier cannot name them; live model triage, see `07-agents.md` §2.1). All are `pending`, have no open inbox item and no status check due before Mon 11/02, so the 10:40 numbers above are unchanged (they are inside the 57 pending · $46,520):
  - `clm_4744` P. Hale · MetLife · DOS 09/16 · D6240 pontic #14 + D6750 #13, #15 = $3,450 · sent 09/16, accepted 09/17 · day-30 check 10/16 returned "pended for information"; next check day 45 = Sat 10/31 → Mon 11/02 · portal correspondence 10/22 (untrusted text): "Please provide the date of extraction of tooth #14 and indicate whether this is an initial placement or a replacement prosthesis." PMS history: D7140 #14 on 2019-03-02 (signed note). Coverage has `missing_tooth_clause=true`. Used by demo step 3b. Plan fixture `planner/recorded/clm_4744.plan.json` (records request with the 2019 note).
  - `clm_4709` · Cigna · D2950 + D2740 #3 · pending 52 d · IVR transcript 10/27: "in review with the dental consultant; x-rays received; narrative illegible, please resend".
  - `clm_4731` · Guardian · D7210 #17 · pending 47 d · portal: "Claim adjusted — see EOB 10/20"; no 835 on file (Guardian sends 835s only on request for small EFTs).
- Appealed: Ruiz $960 · Lund $320 · Varga $640 = $1,920
- Today's claims (10/28): Owens #4859 (second visit 10:00, Ready for 10:45 file), Ortega (SRP: LR sent, UR not billable — no depths charted; never nudge documentation), Brennan (D2392 sent as-is, alt benefit expected, pt est $71.60), Russo (D0274 sent, will deny PR-frequency, acknowledgment on file 03/11), Akers (secondary held for Delta 835; timely from primary EOB), Iqbal (subscriber id fix after Vyne A7:164), Lindgren (rendering-provider mismatch, held 10:51), Novak #4855 (Delta D3320 #13 $915), Reyes #4858 (checkout 10:40, molar crown, Guardian alt-benefit possible), Romano, Kowalski, Torres (NY Medicaid, D9941 non-covered consent 10/14)

**Eligibility (tomorrow Thu 10/29)**: J. Chen 9:00 · annual max $1,500 used $1,320 remaining $180 · planned D4341×2 $410 + D2392 #30 $240 = $650 → insurance $180 / patient $470 → flag to front desk; frequency rows with last-done dates from the PMS history (D4341 03/12/2024, D0274 11/03/2025 → OK from 11/03/2026, D1110 04/14/2026; S. Kim: D0274 11/03/2025, D1110 05/02/2026). *Fees:* the practice fee schedule is D4341 **$240** and D2392 **$255** (#4748 bills $255; Abara's MetLife allowed $215.60 must stay ≤ the fee); J. Chen's planned amounts come from her 2025 treatment plan ($205 / $240) — a stale treatment-plan fee, kept on purpose because that is how a PMS behaves, and the estimate uses the plan's amounts. Other rows: W. Ito, E. Ford, N. Park (third "human look"), C. Webb, M. Alvarez, R. Patel (verified).

**Remittances**: Cigna ERA 12 lines on 7 claims, billed $1,755.00; allowed $1,158; CO-45 $597; PR-1 $32; PR-2 $88.40; 11 auto-posted ($846.00), Foster held ($108.80); Guardian paper check #208841 $640 needs review, not yet deposited; Guardian $212 EFT (trace GRD…) 835 requested 10/27; Aetna ERA auto-posted 6 of 6 (#4748 as an inbox balance). Bank: expected $13,165.20 · 6 of 7 matched ($12,525.20) · unapplied $212.

**Rules (Settings)**: 19 rows — tier 1 (9): status check · records request → NEA · resubmit with attachment (Delta · missing PA · < $2,000, 23/25 paid, proposed) · reprocessing request · request 835 · send claim · PMS codes · fix demographics, resend · eligibility check · payer rep call (bounded) — tier 2 (7): post ERA line (balanced & patient resp matches tracked benefits) · update PMS benefits · send claim · agent text (Delta × crowns, signed 09/14) · corrected claim (7) · patient-responsibility transfer · send statement · mechanical refund to original tender ≤ $100 (signed 10/27) — tier 3 (3): write-off / void · formal appeal · discretionary refund / waiver / collections. Practice cap $1,000 (tier 1 exempt). Change log 5 rows. Proposals: Delta missing-PA (acceptable) and the same with `root_cause=ours` (guarded, not acceptable), Guardian ≥5 mm "watching · n=1".

**Users**: `usr_dana` (billing), `usr_morgan` (owner, NPI), `usr_lee` (dentist, NPI), `usr_tasha` (front desk).

## Generator rules

- Fees from one practice fee schedule; allowed from per-payer contract schedules (Delta ≈ 80% of fee on major, etc.).
- CDT mix per visit type: hygiene (D0120/D0274 or D0210/D1110/D4910), restorative (D2391–D2394, D2740, D2950), endo (D3310/3320/3330), perio (D4341/D4342/D4910), surgery (D7140/D7210), with tooth numbers 1–32 and plausible surfaces.
- Denial draws per payer (overall ~6% of adjudicated claims, 17/26 preventable), latency draws per payer, 3% clearinghouse A7s concentrated on warn-flagged subscriber ids.
- Patient names are invented; avoid real people. Never use a real PMS or practice name.
