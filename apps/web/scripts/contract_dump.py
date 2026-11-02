"""Drive the real API in-process over a temp DB and dump what it sends, for src/api/real.contract.ts.

Run by `pnpm test:contract` (scripts/contract-real.mjs). Every call names the web schema its response must parse under.
No port is bound and the repo's torch.db is not touched.
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from torch_rcm.api.app import API_PREFIX, create_app
from torch_rcm.config import Settings
from torch_rcm.events import FIREHOSE, replay

DANA = {"X-Torch-User": "usr_dana"}
MORGAN = {"X-Torch-User": "usr_morgan"}
THURSDAY = "2026-10-29T07:10:00-04:00"
TERMINAL = ("succeeded", "failed", "cancelled", "would_have_run")

records: list[dict[str, Any]] = []


def call(client: TestClient, method: str, path: str, schema: str, *, user: dict[str, str] = DANA, **kw: Any) -> Any:
    headers = {**user, "Idempotency-Key": f"contract-{len(records)}"}
    res = client.request(method, API_PREFIX + path, headers=headers, **kw)
    body = res.json()
    records.append({"method": method, "path": path, "schema": schema, "status": res.status_code, "body": body})
    return body


def reads(client: TestClient) -> None:
    inbox = call(client, "GET", "/inbox?group=true&state=open", "InboxList")
    for item in inbox["items"]:
        call(client, "GET", f"/inbox/{item['id']}", "InboxItemDetail")
    claims = call(client, "GET", "/claims?limit=500", "ClaimList")
    for row in claims["items"]:
        detail = call(client, "GET", f"/claims/{row['id']}", "ClaimDetail")
        for entry in detail["timeline"]:
            if entry.get("evidence_ids"):
                held = call(client, "GET", f"/runs/{entry['run_id']}", "RunDetail")
                records.append(
                    {
                        "kind": "timeline_evidence",
                        "entry": entry["id"],
                        "wanted": entry["evidence_ids"],
                        "held": [e["id"] for e in held["evidence"]],
                    }
                )
    for path, schema in (
        ("/summary/strip", "StripSummary"),
        ("/clock", "Clock"),
        ("/agents/status", "AgentsStatus"),
        ("/views", "ViewList"),
        ("/rules", "RulesOut"),
        ("/rules/changes", "RuleChangeList"),
        ("/proposals", "ProposalList"),
        ("/activity", "ActivityOut"),
        ("/ledger/today", "Ledger"),
        ("/denials", "DenialsOut"),
        ("/_world/payers", "WorldPayers"),
        ("/settings/preview?rule_id=rule_t1_delta_pa&mode=auto", "Preview"),
    ):
        call(client, "GET", path, schema)
    call(client, "GET", "/cash", "CashSummary", user=MORGAN)
    eligibility = call(client, "GET", "/eligibility", "EligibilityOut")
    for row in eligibility["rows"]:
        call(client, "GET", f"/eligibility/{row['appointment_id']}", "BenefitsPanel")


def wait_for_run(client: TestClient, run_id: str) -> None:
    for _ in range(600):
        if client.get(f"{API_PREFIX}/runs/{run_id}", headers=DANA).json()["run"]["status"] in TERMINAL:
            return
        time.sleep(0.05)
    raise TimeoutError(run_id)


def mutations(client: TestClient) -> str:
    inbox = client.get(f"{API_PREFIX}/inbox?group=true&state=open", headers=DANA).json()
    group = inbox["groups"][0]["group_key"]
    approved = call(client, "POST", "/inbox:approve-group", "ApproveGroupResponse", json={"group_key": group})
    for run in approved["runs"]:
        wait_for_run(client, run["id"])
    singles = [i for i in inbox["items"] if not i.get("group_key") and i["claim"] and i["tier"] == 1]
    call(client, "POST", f"/inbox/{singles[0]['id']}:reject", "ItemResponse", json={"reason": "contract check"})
    call(client, "POST", f"/inbox/{singles[1]['id']}:snooze", "ItemResponse", json={"until": THURSDAY})
    call(client, "POST", f"/inbox/{singles[1]['id']}:reopen", "ItemResponse")
    call(client, "POST", "/views", "SavedView", json={"name": "Denied", "search_params": {"status": ["denied"]}})
    triage = call(client, "POST", "/claims/clm_4744:triage", "TriageAccepted", json={"agent": "followup"})
    wait_for_run(client, triage["run"]["id"])
    call(client, "PATCH", "/rules/rule_t1_status_check", "RulePatchResponse", json={"mode": "auto"})
    call(client, "POST", "/proposals/prop_delta_pa:accept", "ProposalResponse")
    call(client, "POST", "/proposals/prop_guardian_5mm:dismiss", "ProposalResponse")
    call(client, "PATCH", "/settings/practice", "PracticeSettings", user=MORGAN, json={"practice_cap_cents": 100_000})
    call(client, "POST", "/agents:pause", "AgentsStatus", user=MORGAN)
    call(client, "POST", "/agents:resume", "AgentsStatus", user=MORGAN)
    call(client, "GET", "/claims/does-not-exist", "ErrorEnvelope")
    return str(approved["runs"][0]["id"])


def main(out: Path) -> None:
    db = Path(tempfile.mkdtemp()) / "contract.db"
    app = create_app(Settings(db_url=f"sqlite:///{db}", worker=True, log_level="ERROR"))
    with TestClient(app) as client:
        reads(client)
        run_id = mutations(client)
        call(client, "GET", f"/runs/{run_id}", "RunDetail")
        accepted = call(client, "POST", "/clock/advance", "ClockAdvanceAccepted", user=MORGAN, json={"to": THURSDAY})
        path = f"{API_PREFIX}/clock/advance/{accepted['advance_id']}"
        for _ in range(1200):
            if client.get(path, headers=MORGAN).json()["done"]:
                break
            time.sleep(0.1)
        call(client, "GET", f"/clock/advance/{accepted['advance_id']}", "AdvanceOut", user=MORGAN)
        reads(client)
        store = app.state.runtime.store
        run_frames = [{"event": e.event, "data": e.data} for e in replay(store, run_id, 0)]
        firehose = [{"event": e.event, "data": e.data} for e in replay(store, FIREHOSE, 0)]
        call(client, "POST", "/clock/reset", "ClockReset", user=MORGAN)
    (out / "http.json").write_text(json.dumps(records, default=str))
    (out / "run_frames.json").write_text(json.dumps({"run_id": run_id, "frames": run_frames}, default=str))
    (out / "firehose.json").write_text(json.dumps(firehose, default=str))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
