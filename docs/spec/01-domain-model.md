# Domain model and enums (the contract every package builds against)

Source of truth for types is **one Pydantic model set in `apps/api/torch/domain/`** exported to OpenAPI, from which the web client generates Zod schemas (`apps/web/src/api/schema.ts` via `openapi-zod-client`). Never hand-write a type on the web side that exists on the API side. Money is integer **cents** everywhere; render as dollars only in the UI.

IDs are deterministic in the seed (`clm_4821`, `pat_owens_k`, `rule_t1_delta_pa`) so the demo script can reference them.

## Enums

```text
ClaimStatus      = ready | sent | rejected | accepted | pending | denied | partial | paid | appealed
                   (write-off is a terminal *reason* on a denied/partial claim, not a status)
AckStage         = none | file_999_ok | file_999_reject | ch_277ca_a1 | ch_277ca_a7 | payer_277ca_a1 | payer_277ca_a7
Tier             = 1 | 2 | 3
RuleMode         = observe | ask | auto | human_only
RuleTier1Actions = status_check | records_request | resubmit_with_attachment | reprocessing_request | request_835 | send_claim_pms_codes | fix_demographics_resend | eligibility_check
RuleTier2Actions = post_era_line | update_pms_benefits | send_claim_agent_text | corrected_claim | patient_transfer | send_statement | mechanical_refund | cob_order_change
RuleTier3Actions = write_off | formal_appeal | void_claim | discretionary_refund | collections_referral | waiver
InboxItemKind    = approve_action | review_draft | eligibility_flag | variance | run_failed | rule_proposal | owner_signoff
InboxItemState   = open | approved | edited | rejected | snoozed | expired | done
RunStatus        = queued | running | succeeded | failed | cancelled | would_have_run
AgentKind        = eligibility | claims | followup | appeals | posting
RootCause        = ours | payer | patient | unknown
DeadlineKind     = timely_filing | appeal | none
EvidenceKind     = portal_screenshot | ivr_transcript | rep_call | era_line | eob_pdf | pms_record | nea_attachment | policy_clause | prior_eob | note_excerpt
PayerKey         = delta_ny | metlife | cigna | aetna | guardian | ny_medicaid
Role             = owner | billing | dentist | front_desk
```

## Claim status transitions

```text
ready ──send──▶ sent ──999 ok, 277CA A1 (clearinghouse)──▶ sent
sent ──277CA A7 (clearinghouse or payer)──▶ rejected ──fix, resend──▶ sent
sent ──payer 277CA A1/A2 (ICN assigned)──▶ accepted ──day 1──▶ pending
pending ──835──▶ paid | partial | denied
denied ──records sent / reconsideration──▶ pending (same claim, in-flight flag)
denied ──corrected claim (freq 7)──▶ sent (new claim id, links original)
denied ──formal appeal filed──▶ appealed ──decision──▶ paid | partial | denied(upheld)
denied | partial ──write_off (tier 3)──▶ terminal (status unchanged, reason recorded)
any ──void (freq 8, tier 3)──▶ terminal
```

Who may trigger what: tier 1 rules may move `ready→sent`, `rejected→sent` (demographic fix), `denied→pending` (records/reconsideration); tier 2 may create a corrected claim and post 835 lines; tier 3 transitions are human-only. `needs_action` is set by the server whenever an open InboxItem references the claim.

Status-check cadence: **day 30** from send, then every 15 days.

## Entities (fields that matter; add what you need, don't rename these)

- **Practice** `id, name, locations[], prompt_pay_days_electronic=30, prompt_pay_days_paper=45`
- **Location** `id, practice_id, name`
- **User** `id, name, role, location_ids[], npi?`
- **Payer** `key, name, payer_id, type (ppo|self_funded_erisa|medicaid), timely_filing_days, appeal_window_days, appeal_levels, file_times[] (e.g. ["10:45","11:15"] for Delta), rules (see 03-mock-world)`
- **Patient** `id, first, last, dob, guarantor_id?, contact_pref (text|email|paper), location_id`
- **Coverage** `id, patient_id, payer_key, subscriber_id, group_no, order (primary|secondary), plan: {annual_max_cents, deductible_cents, deductible_met_cents, used_cents, pct_preventive, pct_basic, pct_major, frequencies[{cdt, per_months, last_done?}], missing_tooth_clause, waiting_period_days}, verified_at, verified_via (portal|ivr|271|intake)`
- **Provider** `id, user_id, npi, type (dentist|hygienist)`
- **Appointment** `id, patient_id, provider_id, location_id, start, planned_procedures[], eligibility_status (verified|issue|unverified|checking)`
- **Visit** `id, appointment_id, completed_at, note_signed_by?, note_signed_at?`
- **ProcedureLine** `id, visit_id, cdt, tooth?, surface?, quadrant?, fee_cents, provider_id`
- **Claim** `id, number (int, e.g. 4821), visit_id, patient_id, coverage_id, payer_key, status, needs_action (derived), dos, built_at, sent_at?, file_time?, icn?, ack_stage, billed_cents, allowed_cents?, paid_cents?, writeoff_cents?, patient_resp_cents?, denial? {carc, rarc, decoded, root_cause}, deadline {kind, due_on, basis}, parent_claim_id? (corrected/secondary), frequency_code? (1|7|8), readiness[] (see below), timely_filing_due`
- **ClaimLine** `id, claim_id, cdt, tooth?, surface?, fee_cents, allowed_cents?, paid_cents?, adj[] {group (CO|PR|OA), code, cents}, patient_cents?`
- **Attachment** `id, claim_id, kind (pa|bwx|fmx|perio_chart|narrative|eob), nea_number?, source (pms_imaging|agent|user), created_at`
- **ReadinessCheck** `key (note_signed|procs_match_note|fee_schedule|subscriber_id_format|eligibility_fresh|remaining_max|frequency|tooth_validity|attachment_rule|narrative|cob_order|duplicate|timely_filing), status (pass|warn|fail|na), detail`
- **AckEvent** `id, claim_id, stage, code?, message, at`
- **Rule** `id, tier, action, scope {payer_key?, item_type, max_cents?}, mode, confidence_floor?, outcome_metric? (paid_30d|accepted|balanced|none), reverses_in (until_file_leaves|until_day_close|void_only|none), requires_owner_signoff, signed_by?, signed_at?, changed_by, changed_at, ran_without_review_7d, base_rate {n, k}`
- **RuleChange** `id, rule_id, at, by, before, after, items_affected_since`
- **RuleProposal** `id, rule_draft, evidence {approved, total, outcome_k, outcome_n}, root_cause_guard (bool), state (open|accepted|dismissed)`
- **InboxItem** `id, kind, state, claim_id?, patient_id?, appointment_id?, agent, title, recommendation, confidence {pct, basis}, evidence[] (Evidence ids), proposed_action (action enum + params), tier, group_key? (payer×item_type for batch), created_at, snoozed_until?, resolved_by?, resolved_at?, run_id?`
- **Evidence** `id, kind, title, excerpt, uri?, captured_at, reference? (ICN, call ref, NEA#)`
- **Run** `id, agent, trigger (rule|approval|schedule|manual), rule_id?, inbox_item_id?, claim_id?, status, started_at, finished_at?, steps[], result_summary, audit_line`
- **RunStep** `idx, name, status (pending|running|ok|failed|skipped), started_at?, finished_at?, tool, input_summary, output_summary, evidence_ids[]`
- **Remittance** `id, payer_key, kind (835|paper_eob), trace, amount_cents, received_at, deposit_status, lines[] RemitLine, status (auto_posted|needs_review|unmatched)`
- **RemitLine** `id, remittance_id, claim_id, claim_line_id, billed, allowed, paid, adj[], patient_cents, match (auto|review|unmatched), variance_cents?`
- **Hold** `id, subject (claim|patient_balance), subject_id, reason, held_since, clears_when, owner_user_id`
- **Estimate** `id, appointment_id, as_of, basis (portal|ivr|271), lines[], patient_est_cents, signed_at?, consent {card_last4, ceiling_cents, expires}`
- **Statement** `id, patient_id, lines[], due_on, sent_via, sent_at, disputed_cents`
- **Appointment eligibility items, Patient balance** — read models over the above.

## Derived read models (server computes, client never recomputes)

- `GET /summary/strip` → counts and cents per ClaimStatus + flag counts (the pipeline strip).
- `GET /inbox?state=open` sorted by priority (deadline proximity × cents × tier).
- `GET /settings/preview?rule_id&mode` → "N of this week's M would have run" + holds by root cause.
- `GET /cash` → KPIs with formulas shown (days in A/R = total A/R ÷ avg daily net production; net collection rate = collections ÷ (production − contractual adjustments) over 90 d).

## Invariants (write tests for these)

- Σ `RemitLine.paid + adj + patient` = `billed` per line.
- Strip counts = `GROUP BY status` of claims; inbox badge = count of open items; Activity "awaiting you" = same number.
- `needs_action` is true iff an open InboxItem references the claim.
- A Run with `status=would_have_run` exists iff the governing rule was in `observe`.
- No Rule with `action ∈ Tier3Actions` has `mode ≠ human_only`.
- No RuleProposal with `root_cause_guard=true` can be accepted.
