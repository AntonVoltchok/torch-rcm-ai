"""Build docs/design/onboarding/tour-mock.html from the captures.

    python3 docs/design/onboarding/capture/build.py <capture-dir>

<capture-dir> holds what the capture scripts wrote (README.md, "Regenerate"):
    cap/dom/*.html      #root innerHTML of the real app per screen and state (snap.cjs, mutate.cjs)
    cap/app.css         the compiled stylesheet the dev server served (snap.cjs, first job)
    cap/design_*.jpg    the design frames the two mock-only routes show (design.cjs)
    payloads/raw/*.json API responses (get.py) and mutation responses (mutate.cjs)
    payloads/raw/events_*.txt   SSE replays (curl)
    payloads/model/*.txt        render_case, plans, ROWS, recipes, schemas (model renders, README.md)

Nothing here invents data: every drawer is a trimmed captured response or a rendered/verbatim source excerpt, and
every number the step copy states is asserted against the captured JSON in CHECKS (the build fails if one drifts).
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CAP = Path(sys.argv[1]).resolve()
RAW = CAP / "payloads" / "raw"
MODEL = CAP / "payloads" / "model"
DOM = CAP / "cap" / "dom"


# ---------------------------------------------------------------- formatting
def body(name: str):
    return json.loads((RAW / f"{name}.json").read_text())["body"]


def mut(fragment: str, status: int | None = None):
    for p in sorted(RAW.glob("mut_*.json")):
        d = json.loads(p.read_text())
        if fragment in p.name and (status is None or d["status"] == status):
            return d
    raise SystemExit(f"no mutation capture matching {fragment}")


def fmt(o, ind: int = 0, maxlist: int = 3, width: int = 92) -> str:
    """JSON, compact where a value fits on one line; long arrays cut with a `# … N more` line (shape kept)."""
    one = json.dumps(o, ensure_ascii=False)
    pad = " " * ind
    if len(one) + ind <= width or not isinstance(o, (dict, list)) or not o:
        return one
    if isinstance(o, dict):
        items = list(o.items())
        out = ["{"]
        for i, (k, v) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            out.append(f'{pad}  "{k}": {fmt(v, ind + 2, maxlist, width)}{comma}')
        out.append(pad + "}")
        return "\n".join(out)
    shown = o[:maxlist]
    out = ["["]
    for i, v in enumerate(shown):
        comma = "," if i < len(o) - 1 else ""
        out.append(f"{pad}  {fmt(v, ind + 2, maxlist, width)}{comma}")
    if len(o) > maxlist:
        out.append(f"{pad}  # … {len(o) - maxlist} more")
    out.append(pad + "]")
    return "\n".join(out)


def pick(o: dict, *keys: str) -> dict:
    return {k: o[k] for k in keys if k in o}


def drop(o: dict, *keys: str) -> dict:
    return {k: v for k, v in o.items() if k not in keys}


def model(name: str, lines: tuple[int, int] | None = None) -> str:
    t = (MODEL / f"{name}.txt").read_text().rstrip()
    if lines:
        ls = t.splitlines()
        t = "\n".join(ls[lines[0] : lines[1]])
    return t


def sse(name: str, keep: int = 99, skip_started: bool = True) -> str:
    """The SSE replay, one event per block; `phase: started` frames dropped for length (the `completed` frame carries the result)."""
    blocks = [b for b in (RAW / f"events_{name}.txt").read_text().strip().split("\n\n") if b.strip()]
    out, dropped = [], 0
    for b in blocks:
        if skip_started and '"phase": "started"' in b:
            dropped += 1
            continue
        lines = b.splitlines()
        data = next((ln for ln in lines if ln.startswith("data: ")), "")
        try:
            d = json.loads(data[6:])
            d = {k: v for k, v in d.items() if v not in (None, [], "", {}) or k in ("status",)}
            d.pop("run_id", None)
            data = "data: " + json.dumps(d, ensure_ascii=False)
        except ValueError:
            pass
        out.append("\n".join([ln for ln in lines if not ln.startswith("data: ")] + [data]))
    shown = out[:keep]
    tail = [f"# … {len(out) - keep} more events"] if len(out) > keep else []
    return f"# ({dropped} `phase: started` frames omitted; run_id omitted from each frame)\n" + "\n\n".join(shown + tail)


def section(title: str) -> str:
    return f"\n# ── {title} " + "─" * max(4, 90 - len(title))


# ---------------------------------------------------------------- the drawers
D: dict[str, str] = {}
STAMP = "captured from the running API · canonical seed · clock Wed 10/28 10:40 · X-Torch-User: usr_dana"

claim = body("claim_4821")
D["claim"] = "\n".join(
    [
        "# GET /api/v1/claims/clm_4821  (ClaimDetailOut)",
        f"# {STAMP}",
        fmt(
            {
                "claim": drop(claim["claim"], "patient"),
                "coverage": pick(claim["coverage"], "id", "payer_key", "plan_name", "order", "remaining_max_cents", "verified_at", "verified_via"),
                "lines": claim["lines"],
                "attachments": claim["attachments"],
                "denial": claim["denial"],
                "deadline": claim["deadline"],
                "money": claim["money"],
                "timeline": claim["timeline"],
                "timely_filing_due": claim["timely_filing_due"],
            },
            maxlist=3,
        ),
        "# money is integer cents everywhere on the server; the UI formats it",
    ]
)
D["clock"] = "\n".join(["# GET /api/v1/clock", fmt(body("clock")), section("the claim the tour follows"), D["claim"]])

strip = body("strip")
s = dict(strip)
s["tiles"] = [dict(t, by_holder=t["by_holder"][:2] + ([f"… {len(t['by_holder']) - 2} more"] if len(t["by_holder"]) > 2 else [])) for t in strip["tiles"]]
D["strip"] = "\n".join(
    [
        "# GET /api/v1/summary/strip  (StripOut) — every tile, nav badge and header count on screen is a field here",
        f"# {STAMP}",
        fmt(s, maxlist=9),
        "# needs_action is a derived flag (flagged_count), never a tenth status; the browser never counts rows",
    ]
)

remit = body("remittance_delta")
line = [ln for ln in remit["lines"] if ln.get("claim_id") == "clm_4821"]
D["denial"] = "\n".join(
    [
        "# 1 · GET /api/v1/remittances/rem_delta_1026  (the 835 as parsed; only #4821's lines kept)",
        fmt(dict(drop(remit, "lines"), lines=line + [f"# … {len(remit['lines']) - len(line)} more lines on this ERA"]), maxlist=6),
        "# invariant (tested): billed = paid + Σadj + patient on every line",
        section("2 · domain/routing.py — CARC·RARC → next action → agent (shared with the Denials worklist)"),
        'def route_denial(carc, rarc, *, root_cause, payer, self_funded) -> Route:',
        '    key = f"{carc}:{rarc}" if rarc else carc',
        '    if key in ("CO-16:N29", "CO-16:M127") or carc == "CO-16":',
        '        return Route(NextAction.RECONSIDERATION, AgentKind.FOLLOWUP, "missing documentation: send it, no appeal needed")',
        "    # … CO-119, CO-22, CO-50/29/197 (appeal, dentist signs) — verbatim in the repo",
        section("3 · root cause, computed by code from provenance (agents/case.py)"),
        fmt({"attachments": claim["attachments"], "denial": claim["denial"]}),
        "# _sticky_cause: once ours, always ours. The model never sets root cause.",
    ]
)

item = body("inbox_4821")
case_lines = (MODEL / "case_4821.txt").read_text().splitlines()
handles = []
for ln in case_lines:
    m = re.search(r'kind="([^"]+)" evidence_id="(E\d+)"', ln)
    if m:
        ev = next((e for e in item["evidence"] if e["kind"] == m.group(1) or (m.group(1) == "pms_record" and e["kind"].startswith("pms"))), None)
        handles.append(f"#   {m.group(2)} → {ev['id'] if ev else '(no inbox evidence of this kind)'}  ({m.group(1)})")
D["prompt"] = "\n".join(
    [
        "# What a live Follow-up run sends (deterministic mode, the default, sends nothing: the scripted planner plans 4821)",
        section("system prompt (static, cached) — agents/prompts/followup.md, excerpt, verbatim"),
        model("system_followup")[model("system_followup").find("\n") + 1 :],
        section("first user message — planner/live.py render_case(build_case(clm_4821)), rendered on the seed"),
        "\n".join(case_lines[1:]),
        section("evidence handles: the model sees E-numbers, the item stores ids (Handles in planner/live.py)"),
        *handles,
    ]
)
D["plan"] = "\n".join(
    [
        "# Ids: this plan was built in a harness run, so its PMS-image evidence is ev_run_4821_1; the seeded Inbox item",
        "# cites ev_4821_pa for the same image, and the model would see it as E3 (handle table on the prompt tab).",
        model("plan_4821"),
        section("the terminal tool the model must call alone — agents/tools/schemas.py (strict; no PHI in enum/const)"),
        model("tools_schemas"),
    ]
)
D["policy"] = model("policy_rows")

D["item"] = "\n".join(
    [
        "# GET /api/v1/inbox/itm_4821  (InboxItemOut) — every sentence on the decision panel is a field here",
        f"# {STAMP}",
        fmt(
            pick(item, "id", "kind", "headline", "summary", "recommendation", "agent", "tier", "cents", "confidence", "group_key", "group_title",
                 "rule_id", "stopped_by", "root_cause", "action_label", "touches", "lands", "learnable", "plan_steps", "audit_note",
                 "proposed_action", "deadline_on"),
            maxlist=4,
        ),
        "# confidence.pct is present only when n ≥ 5 (validator); the client bolds k of n and never parses basis",
    ]
)
D["evidence"] = "\n".join(
    [
        "# GET /api/v1/inbox/itm_4821 → evidence[]  (what each evidence row renders; trust comes from the source)",
        fmt(item["evidence"], maxlist=5),
    ]
)
appr = mut("approve-group")
appr_body = appr["body"]
D["approve"] = "\n".join(
    [
        "# What the Inbox sends (features/inbox/ItemForms.tsx · hooks): shift+A approves the group",
        f"{appr['request']}",
        f"Idempotency-Key: {appr['headers'].get('idempotency-key', '(per click)')}",
        f"X-Torch-User: {appr['user']}",
        json.dumps(appr["request_body"]),
        section(f"{appr['status']} Accepted — captured response (items trimmed)"),
        fmt(
            {
                "items": [pick(i, "id", "state") for i in appr_body["items"]],
                "runs": [pick(r, "id", "trigger", "actor", "planner", "status", "action", "action_label", "plan") for r in appr_body["runs"]][:1]
                + [f"… {len(appr_body['runs']) - 1} more runs"],
                "changes": appr_body["changes"],
                "meta": {"counts": {k: v for k, v in appr_body["meta"]["counts"].items() if k in ("inbox_open", "inbox_claims", "flagged_count", "ar_count")}},
            },
            maxlist=6,
        ),
        "# the UI writes meta.counts into ['strip'] and renders `changes` as What changed; it computes neither",
        section("the recipe the approval run executes — agents/catalog/recipes.py (no model call)"),
        model("recipes"),
    ]
)
D["events"] = "\n".join(
    [
        "# GET /api/v1/runs/run_appr_4821_1028104000/events  (text/event-stream, replayed from stored run_events;",
        "#   reconnect with Last-Event-ID resumes). Planner: ApprovedPlanPlanner (executor.py) — an approval run",
        "#   replays the approved plan: no reads, no model call, in either mode.",
        sse("run_appr_4821_1028104000", keep=14),
    ]
)
adv = mut("clock_advance")
st = body("advance_status")
strip_thu = body("strip_thu")
D["advance"] = "\n".join(
    [
        f"# {adv['request']}   as {adv['user']} (the clock is the owner's control)",
        json.dumps(adv["request_body"]),
        f"→ {adv['status']} " + json.dumps(adv["body"]),
        section("GET /api/v1/clock/advance/" + st["advance_id"] + " — progress, then done (the firehose streams the same)"),
        fmt(dict(drop(st, "meta"), events_fired=st["events_fired"][:6] + [f"… {len(st['events_fired']) - 6} more events"]), maxlist=8),
        "# meta.counts carries the whole Thursday strip; summarised below",
        section("GET /api/v1/summary/strip afterwards (Thu 7:10) — Wednesday → Thursday"),
        *[
            f"  {k:<16} {strip[k]!s:>8} → {strip_thu[k]}"
            for k in ("inbox_open", "inbox_claims", "inbox_visits", "open_count", "ar_count", "flagged_count", "paid_month_count", "as_of")
        ],
        "  inbox_waiting    " + json.dumps([w.get("label", w) for w in strip_thu["inbox_waiting"]], ensure_ascii=False),
        "  denied tile      " + str(next(t["count"] for t in strip["tiles"] if t["status"] == "denied")) + " → " + str(next(t["count"] for t in strip_thu["tiles"] if t["status"] == "denied")),
    ]
)

inbox = body("inbox")
D["inbox"] = "\n".join(
    [
        "# GET /api/v1/inbox  (InboxOut) — the queue; total/actionable/waiting are server fields",
        f"# {STAMP}",
        fmt(dict(inbox, items=[pick(i, "id", "kind", "agent", "tier", "headline", "group_key", "cents", "priority", "lands") for i in inbox["items"]][:4]
                 + [f"… {len(inbox['items']) - 4} more items"]), maxlist=6),
    ]
)
D["moves"] = "\n".join(
    [
        "# The three whose-move cards are StripOut.moves (readmodels/moves.py: first matching rule wins:",
        "#   closed → active run → open item → hold → queued file → status). An invariant test says they sum to open claims.",
        fmt({"moves": strip["moves"], "open_count": strip["open_count"], "inbox_open": strip["inbox_open"], "inbox_claims": strip["inbox_claims"],
             "inbox_visits": strip["inbox_visits"], "inbox_waiting": strip["inbox_waiting"]}, maxlist=5),
        section("one claim's move — ClaimSummary.move on every row (mine is a server bool; the browser never compares holders)"),
        fmt(item["claim"]["move"]),
    ]
)
D["search"] = "\n".join(
    [
        "// The URL is the source of truth for filters, sort, selection and tabs (route validateSearch with Zod)",
        "// apps/web/src/features/*/search.ts — verbatim",
        *[(Path(HERE.parents[3] / "apps/web/src/features" / f)).read_text().strip() for f in ("claims/search.ts",)],
        "",
        "// examples this mock was captured from",
        "/inbox?item=itm_4821",
        "/claims?status=denied          ← the strip's Denied link; a refresh keeps it",
        "/activity?observe=true",
        "/eligibility?appt=apt_1029_chen_j",
        "/settings/agents?tab=proposals",
    ]
)

dn = body("denials")
D["denials"] = "\n".join(
    [
        "# GET /api/v1/denials  (DenialsOut) — groups by next action (route_denial), rows sorted by deadline inside a group",
        f"# {STAMP}",
        fmt(dict(dn, groups=[dict(g, rows=[pick(r, *[k for k in r if k != "claim"]) | {"claim": pick(r["claim"], "id", "number", "status", "move")} for r in g["rows"][:1]] + ([f"… {len(g['rows']) - 1} more rows"] if len(g["rows"]) > 1 else [])) for g in dn["groups"]]), maxlist=4),
    ]
)
D["denials_matrix"] = "\n".join(
    [
        "# DenialsOut.matrix — one cell per column with zeros included; plan limits (PR-*) left out and counted in `excluded`",
        "# test_server_totals.py::test_denials_matrix_* recounts it by CARC over HTTP",
        fmt(dn["matrix"], maxlist=8),
    ]
)
dthu = body("denials_thu")
D["denials_thu"] = "\n".join(
    [
        "# GET /api/v1/denials after Skip to Thu 7:10 — the overnight denials join, routed by the same function",
        fmt({"total": dthu["total"], "groups": [{"next_action": g["next_action"], "label": g["label"], "count": g["count"],
             "rows": [{"claim": r["claim"]["number"], "patient": r["claim"]["patient"]["display_name"], "reason": r["claim"].get("reason"),
                       **pick(r, "deadline", "signer", "checklist", "signer_note")} for r in g["rows"]]} for g in dthu["groups"]]}, maxlist=6),
    ]
)

ledger = body("ledger")
D["ledger"] = "\n".join(
    [
        "# GET /api/v1/ledger/today  (LedgerToday) — totals and files are server fields (ADR-0008 §9)",
        f"# {STAMP}",
        fmt(dict(ledger, sent=ledger["sent"][:1] + [f"… {len(ledger['sent']) - 1} more"], leaving_next_file=ledger["leaving_next_file"][:2] + [f"… {len(ledger['leaving_next_file']) - 2} more"],
                 held=ledger["held"][:1] + [f"… {len(ledger['held']) - 1} more"]), maxlist=4),
    ]
)
cd = body("claims_denied")
D["claims_denied"] = "\n".join(
    [
        "# GET /api/v1/claims?status=denied  (ClaimListOut) — server-side filter and sort; total/flagged are server fields",
        f"# {STAMP}",
        fmt(dict(cd, items=cd["items"][:2] + [f"… {len(cd['items']) - 2} more"]), maxlist=4),
    ]
)
c4744 = body("claim_4744")
tri = mut("triage")
D["triage"] = "\n".join(
    [
        f"# {tri['request']}   " + json.dumps(tri["request_body"]),
        f"→ {tri['status']} Accepted (captured; run trimmed)",
        fmt({"run": pick(tri["body"]["run"], "id", "agent", "trigger", "actor", "claim_id", "idempotency_key", "status", "mode", "planner")}),
        section("GET /api/v1/runs/run_triage_4744_1028104000/events — the steps the pane streamed"),
        sse("run_triage_4744_1028104000", keep=10),
    ]
)
D["plan4744"] = "\n".join(
    [
        "# What deterministic mode replays for #4744, and the model-turn format a live run uses.",
        "# HONEST LABEL: the cassette below is hand-authored in the live format (header `synthetic: true`), NOT a captured",
        "# Anthropic API response. Its plan JSON says `recorded_from: live triage…`; that overstates it (see DECISIONS.md D3).",
        model("plan_4744"),
    ]
)
D["case4744"] = "\n".join(["# planner/live.py render_case(build_case(clm_4744)) — the first user message a live triage sends", model("case_4744")])

D["rules"] = "\n".join(
    [
        "# GET /api/v1/rules  (RulesOut) — tiers, counts and the week's tally are server fields",
        f"# {STAMP}",
        fmt(dict(body("rules"), tiers=[dict(t, rules=t["rules"][:1] + [f"… {len(t['rules']) - 1} more rules"]) if (i == 0 and "rules" in t) else dict(drop(t, "rules"), rules=[f"… {len(t.get('rules', []))} rules"]) for i, t in enumerate(body("rules")["tiers"])]), maxlist=4),
    ]
)
D["preview"] = "\n".join(
    [
        "# GET /api/v1/settings/preview — this week's decisions replayed under a hovered mode (nothing is saved)",
        "?rule_id=rule_t1_delta_pa&mode=auto",
        fmt(body("preview_delta_auto")),
        "# UI words it: before_holds 44 · held_total 3 (held_by_root_cause.ours) → would_run 41 · net 0",
        "",
        "?rule_id=rule_t1_status_check&mode=auto",
        fmt(body("preview_status_auto")),
        "# status checks are routine runs, not decisions, so the count does not move",
        "",
        "?rule_id=rule_t1_delta_pa&mode=ask",
        fmt(body("preview_delta_ask")),
    ]
)
props = body("proposals")
acc = mut("prop_delta_pa:accept")
D["proposals"] = "\n".join(
    [
        "# GET /api/v1/proposals — learned from approvals and outcomes (learning.py, pure functions over seeded stats)",
        fmt(props, maxlist=3),
        section(f"{acc['request']} → {acc['status']} (captured; the new learned rule row)"),
        fmt(dict(acc["body"], proposal=pick(acc["body"]["proposal"], "id", "state")), maxlist=3),
        section("the guard — verbatim"),
        model("learning_guard"),
    ]
)
p200 = mut("rule_t2_post_era", 200)
p409 = mut("rule_t2_post_era", 409)
D["signoff"] = "\n".join(
    [
        "# Tier 2 needs the owner's signature. Same PATCH, two viewers (captured in this order):",
        f"{p200['request']}   X-Torch-User: {p200['user']}   " + json.dumps(p200["request_body"]),
        f"→ {p200['status']}",
        fmt(pick(p200["body"]["rule"], "id", "version", "tier", "mode", "requires_owner_signoff", "signed_by", "signed_at", "changed_by", "base_rate")),
        "",
        f"{p409['request']}   X-Torch-User: {p409['user']}   " + json.dumps(p409["request_body"]),
        f"→ {p409['status']} Conflict",
        fmt(p409["body"]),
        "# the client reverts the optimistic mode, toasts “Sent to Dr. Morgan for sign-off”, and the owner's inbox gains the item",
        section("GET /api/v1/rules/changes afterwards"),
        fmt(body("changes_after"), maxlist=3),
    ]
)

act = body("activity")
D["activity"] = "\n".join(
    [
        "# GET /api/v1/activity  (ActivityOut) — summary, by_day and each row's move are server fields",
        f"# {STAMP}",
        fmt(dict(act, rows=act["rows"][:2] + [f"… {len(act['rows']) - 2} more rows"]), maxlist=4),
    ]
)
actf = body("activity_followup")
D["activity_followup"] = "\n".join(
    [
        "# GET /api/v1/activity?agent=followup — the filter is a query param and a URL param (?agent=followup)",
        fmt(dict(actf, rows=actf["rows"][:3] + [f"… {len(actf['rows']) - 3} more rows"]), maxlist=4),
    ]
)
cash = body("cash")
cash_thu = body("cash_thu")
D["cash"] = "\n".join(
    [
        "# GET /api/v1/cash  (owner only; X-Torch-User: usr_morgan) — every KPI carries its formula and basis",
        "# captured from the running API · canonical seed · clock Wed 10/28 10:40",
        fmt(dict(cash, kpis=cash["kpis"][:6] + [f"… {len(cash['kpis']) - 6} more"]), maxlist=5),
        f"# same request as usr_dana → {json.loads((RAW / 'cash_dana.json').read_text())['status']} (role guard on the server, not only the nav)",
        "# after Skip to Thu 7:10: days_in_ar " + str(cash["kpis"][0]["value"]) + " → " + str(cash_thu["kpis"][0]["value"]) + "  (" + cash_thu["kpis"][0]["basis"] + ")",
    ]
)
elig = body("eligibility")
D["eligibility"] = "\n".join(
    [
        "# GET /api/v1/eligibility  (EligibilityOut) — by_day and total are server fields",
        f"# {STAMP}",
        fmt(dict(elig, rows=elig["rows"][:2] + [f"… {len(elig['rows']) - 2} more"]), maxlist=4),
        section("GET /api/v1/eligibility/apt_1029_chen_j — the benefits card"),
        fmt(body("benefits_chen"), maxlist=5),
    ]
)
bal = body("balances")
D["mockonly"] = "\n".join(
    [
        "// apps/web/src/components/MockOnlyBanner.tsx — verbatim",
        (HERE.parents[3] / "apps/web/src/components/MockOnlyBanner.tsx").read_text().strip(),
        "",
        "// apps/web/src/features/shell/nav.ts — status per screen (interactive | static | mock)",
        *[ln.strip() for ln in (HERE.parents[3] / "apps/web/src/features/shell/nav.ts").read_text().splitlines() if ln.strip().startswith("{ to:")],
    ]
)
D["balances"] = "\n".join(
    [
        "# The API already has the data a Patients screen would read; the screen itself is design-only.",
        "# GET /api/v1/patients/balances (feeds Cash › Patient A/R)",
        fmt(dict(bal, items=bal["items"][:2] + [f"… {len(bal['items']) - 2} more"]), maxlist=4),
    ]
)
D["models"] = model("models")
D["guard"] = "\n".join(
    [
        "# GET /api/v1/inbox/itm_4821 → learnable  (the same function POST …:always-auto-run calls; the link shows only when ok)",
        fmt(item["learnable"]),
        "# stopped_by: " + item["stopped_by"],
        section("the guard and the learning code — verbatim"),
        model("learning_guard"),
    ]
)

# ---------------------------------------------------------------- numbers the copy states, asserted
def badge(snap: str) -> int:
    """The Inbox nav badge as a snapshot rendered it."""
    m = re.search(r'data-testid="badge-inbox"[^>]*>(\d+)', (DOM / f"{snap}.html").read_text())
    return int(m.group(1)) if m else -1


tile = lambda s_, st_: next(t for t in s_["tiles"] if t["status"] == st_)  # noqa: E731
CHECKS = [
    ("Dana's queue Wed", strip["inbox_open"], 11),
    ("open items incl. waiting", inbox["total"], 12),
    ("Denied tile Wed", tile(strip, "denied")["count"], 5),
    ("Need action Wed", strip["flagged_count"], 9),
    ("open claims", strip["open_count"], 107),
    ("A/R dollars", strip["ar_cents"], 7550000),
    ("after approve", appr_body["meta"]["counts"]["inbox_open"], 8),
    ("badge after triage on a fresh seed", badge("triage_4744_done"), 12),
    ("badge in every Wednesday screen snapshot", sorted({badge(n) for n in ("inbox", "denials", "ledger", "claims", "claim_4821", "claim_4744", "eligibility_chen", "activity", "settings_rules", "settings_proposals", "settings_t2_dana_409")}), [11]),
    ("confidence k", item["confidence"]["k"], 23),
    ("confidence n", item["confidence"]["n"], 25),
    ("confidence pct", item["confidence"]["pct"], 92),
    ("Thursday queue", strip_thu["inbox_open"], 14),
    ("Thursday denied", tile(strip_thu, "denied")["count"], 9),
    ("runs started overnight", st["runs_started"], 7),
    ("preview before holds", body("preview_delta_auto")["before_holds"], 44),
    ("preview held", body("preview_delta_auto")["held_total"], 3),
    ("preview would run", body("preview_delta_auto")["would_run"], 41),
    ("preview total", body("preview_delta_auto")["total"], 53),
    ("status-check preview", body("preview_status_auto")["would_run"], 41),
    ("days in A/R Wed", cash["kpis"][0]["value"], 27.0),
    ("days in A/R Thu", cash_thu["kpis"][0]["value"], 26.0),
    ("cash as Dana", json.loads((RAW / "cash_dana.json").read_text())["status"], 403),
    ("409 code", p409["body"]["error"]["code"], "owner_signoff_required"),
    ("rules count", body("rules")["rules_count"], 19),
    ("practice cap", body("rules")["practice_cap_cents"], 100000),
    ("denials total", dn["total"], 5),
    ("eligibility appts", elig["total"], 11),
    ("eligibility human look", elig["need_human"], 3),
    ("activity ran without you", act["summary"]["ran_without_you"], 41),
]
bad = [(n, got, want) for n, got, want in CHECKS if got != want]
if bad:
    raise SystemExit("copy numbers drifted from the captures: " + repr(bad))

# ---------------------------------------------------------------- snapshots + css
def snapshot(name: str) -> str:
    html = (DOM / f"{name}.html").read_text()
    html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S)
    m = re.search(r"<iframe[^>]*>(</iframe>)?", html)
    if m:
        which = "payments" if "payments" in name else "patients"
        jpg = base64.b64encode((CAP / "cap" / f"design_{which}.jpg").read_bytes()).decode()
        html = html.replace(m.group(0), f'<img class="design-shot" alt="The reviewed design for {which.title()} (docs/design/mocks.html), as the app frames it" src="data:image/jpeg;base64,{jpg}">')
    return html


SNAPS = [p.stem for p in sorted(DOM.glob("*.html"))]
css = (CAP / "cap" / "app.css").read_text()
css = re.sub(r"@font-face\s*\{[^}]*\}", "", css)
snaps_html = "\n".join(f'<template id="snap-{n}">{snapshot(n)}</template>' for n in SNAPS)

src = (HERE.parent / "tour-src.html").read_text()
out = (
    src.replace("/*__APPCSS__*/", css)
    .replace("/*__DATA__*/", "const D = " + json.dumps(D, ensure_ascii=False, indent=0) + ";")
    .replace("<!--__SNAPS__-->", snaps_html)
    .replace("__COMMIT__", sys.argv[2] if len(sys.argv) > 2 else "unknown")
)
(HERE.parent / "tour-mock.html").write_text(out)
if len(sys.argv) > 3:
    # The artifact host wraps the page in its own document skeleton: publish the same page without ours.
    bare = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", out, count=1, flags=re.I)
    bare = bare.replace("</head>\n<body>\n", "", 1).replace("</body>\n</html>", "")
    Path(sys.argv[3]).write_text(bare)
print(f"wrote tour-mock.html · {len(out) / 1e6:.2f} MB · {len(SNAPS)} snapshots · {len(D)} drawers · {len(CHECKS)} number checks passed")
