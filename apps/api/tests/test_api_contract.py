"""HTTP contract tests: every endpoint over FastAPI's TestClient (httpx), plus "the app's routes equal the
contract table" so openapi.snapshot.json (generated from either) cannot drift. Skipped where FastAPI is not
installed (the service-level tests cover the same behaviour)."""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
testclient = pytest.importorskip("fastapi.testclient")

from torch.api.app import API_PREFIX, create_app  # noqa: E402
from torch.api.contract import ROUTES  # noqa: E402
from torch.config import Settings  # noqa: E402

DANA = {"X-Torch-User": "usr_dana"}
MORGAN = {"X-Torch-User": "usr_morgan"}


@pytest.fixture
def client(tmp_path: Path, template_db: Path) -> Iterator[object]:
    db = tmp_path / "api.db"
    shutil.copy(template_db, db)
    app = create_app(Settings(db_url=f"sqlite:///{db}", worker=False), start_worker=False)
    with testclient.TestClient(app) as c:
        yield c


def url(path: str) -> str:
    return API_PREFIX + path


def test_routes_match_the_contract_table() -> None:
    app = create_app(Settings(db_url="sqlite://"), start_worker=False)
    actual = {
        (m, r.path.removeprefix(API_PREFIX))
        for r in app.routes
        if hasattr(r, "methods")
        for m in r.methods
        if r.path.startswith(API_PREFIX)
    }
    expected = {(r.method, r.path) for r in ROUTES}
    assert actual == expected


def test_openapi_is_served(client) -> None:  # type: ignore[no-untyped-def]
    doc = client.get("/api/openapi.json").json()
    assert url("/summary/strip") in doc["paths"] and "Strip" in doc["components"]["schemas"]


def test_strip_and_inbox(client) -> None:  # type: ignore[no-untyped-def]
    strip = client.get(url("/summary/strip"), headers=DANA).json()
    tiles = {t["status"]: (t["count"], t["cents"]) for t in strip["tiles"]}
    assert tiles["denied"] == (5, 621_000) and tiles["paid"] == (118, 6_130_000) and strip["inbox_open"] == 12
    inbox = client.get(url("/inbox"), params={"state": "open", "group": "true"}, headers=DANA).json()
    assert inbox["total"] == 12 and inbox["groups"][0]["count"] == 3
    item = client.get(url("/inbox/itm_4821"), headers=DANA).json()
    assert item["confidence"]["pct"] == 92 and len(item["evidence"]) == 5


def test_approve_group_202_and_meta_counts(client) -> None:  # type: ignore[no-untyped-def]
    r = client.post(
        url("/inbox:approve-group"), json={"group_key": "delta_ny:denied:CO-16:N29:pa_missing"}, headers=DANA
    )
    assert r.status_code == 202
    body = r.json()
    assert len(body["runs"]) == 3 and body["meta"]["counts"]["inbox_open"] == 9


def test_error_envelope(client) -> None:  # type: ignore[no-untyped-def]
    r = client.post(url("/inbox/itm_4611:approve"), json={}, headers=DANA)
    assert r.status_code == 403 and r.json()["error"]["code"] == "tier_requires_owner"
    r = client.get(url("/claims/clm_nope"), headers=DANA)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.patch(url("/rules/rule_t2_post_era"), json={"mode": "ask"}, headers=DANA)
    assert r.status_code == 409 and r.json()["error"]["code"] == "owner_signoff_required"
    r = client.post(url("/inbox/itm_4821:always-auto-run"), headers=DANA)
    assert r.status_code == 422 and r.json()["error"]["code"] == "root_cause_guard"


def test_claims_query_params(client) -> None:  # type: ignore[no-untyped-def]
    r = client.get(url("/claims"), params={"status[]": "denied"}, headers=DANA).json()
    assert r["total"] == 5
    r = client.get(url("/claims"), params={"needs_action": "true"}, headers=DANA).json()
    assert (r["total"], r["total_cents"]) == (9, 826_500)
    detail = client.get(url("/claims/clm_4821"), headers=DANA).json()
    assert detail["claim"]["icn"] == "26299-041833" and detail["open_inbox_items"][0]["id"] == "itm_4821"


def test_clock_advance_async_and_wait(client) -> None:  # type: ignore[no-untyped-def]
    r = client.post(
        url("/clock/advance"), params={"wait": "true"}, json={"to": "2026-10-29T07:10:00-04:00"}, headers=MORGAN
    )
    assert r.status_code == 200 and r.json()["done"] is True
    tiles = {t["status"]: t["count"] for t in r.json()["meta"]["counts"]["tiles"]}
    assert tiles["denied"] == 9
    r = client.post(url("/clock/advance"), json={"minutes": 30}, headers=MORGAN)
    assert r.status_code == 202
    advance_id = r.json()["advance_id"]
    snapshot = client.get(url(f"/clock/advance/{advance_id}"), headers=MORGAN)
    assert snapshot.status_code == 200


SAMPLES: dict[tuple[str, str], dict] = {  # type: ignore[type-arg]
    ("GET", "/inbox/{item_id}"): {"path": {"item_id": "itm_4705"}},
    ("POST", "/inbox/{item_id}:approve"): {"path": {"item_id": "itm_4705"}, "json": {}},
    ("POST", "/inbox:approve-group"): {"json": {"group_key": "delta_ny:denied:CO-16:N29:pa_missing"}},
    ("POST", "/inbox/{item_id}:reject"): {"path": {"item_id": "itm_4851"}, "json": {"reason": "calling patient"}},
    ("POST", "/inbox/{item_id}:snooze"): {
        "path": {"item_id": "itm_4748"},
        "json": {"until": "2026-10-28T15:00:00-04:00"},
    },
    ("POST", "/inbox/{item_id}:reopen"): {"path": {"item_id": "itm_4748"}, "expect": 409},
    ("POST", "/inbox/{item_id}:always-auto-run"): {"path": {"item_id": "itm_4705"}},
    ("GET", "/claims/{claim_id}"): {"path": {"claim_id": "clm_4744"}},
    ("GET", "/claims/{claim_id}/timeline"): {"path": {"claim_id": "clm_4821"}},
    ("POST", "/claims/{claim_id}:void"): {"path": {"claim_id": "clm_4855"}, "json": {"reason": "dup"}, "user": MORGAN},
    ("POST", "/claims/{claim_id}:corrected"): {"path": {"claim_id": "clm_4733"}, "json": {"changes": {}}},
    ("POST", "/claims/{claim_id}:triage"): {"path": {"claim_id": "clm_4744"}, "json": {}},
    ("POST", "/views"): {
        "json": {"name": "Delta denials", "search_params": {"status": ["denied"], "payer": "delta_ny"}}
    },
    ("GET", "/runs/{run_id}"): {"path": {"run_id": "run_followup_4821_1028"}},
    ("POST", "/runs/{run_id}:cancel"): {"path": {"run_id": "run_followup_4821_1028"}, "expect": 409},
    ("POST", "/agents:pause"): {"user": MORGAN},
    ("POST", "/agents:resume"): {"user": MORGAN},
    ("PATCH", "/rules/{rule_id}"): {"path": {"rule_id": "rule_t1_status_check"}, "json": {"mode": "auto"}},
    ("GET", "/settings/preview"): {"params": {"rule_id": "rule_t1_status_check", "mode": "auto"}},
    ("POST", "/proposals/{proposal_id}:accept"): {"path": {"proposal_id": "prop_delta_pa"}},
    ("POST", "/proposals/{proposal_id}:dismiss"): {"path": {"proposal_id": "prop_guardian_5mm"}},
    ("GET", "/eligibility/{appointment_id}"): {"path": {"appointment_id": "apt_1029_chen_j"}},
    ("GET", "/cash"): {"user": MORGAN},
    ("GET", "/remittances/{remittance_id}"): {"path": {"remittance_id": "rem_cigna_1028"}},
    ("POST", "/_world/reseed"): {"json": {"scenario": "canonical"}},
    ("POST", "/_world/inject"): {"json": {"event": "portal_outage", "payer_key": "delta_ny"}},
    ("POST", "/clock/advance"): {"json": {"minutes": 5}, "params": {"wait": "true"}, "expect": 200},
    ("GET", "/clock/advance/{advance_id}"): {"path": {"advance_id": "adv_missing"}, "expect": 404},
}


@pytest.mark.parametrize("route", [r for r in ROUTES if not r.sse], ids=lambda r: f"{r.method} {r.path}")
def test_every_endpoint_responds(client, route) -> None:  # type: ignore[no-untyped-def]
    sample = SAMPLES.get((route.method, route.path), {})
    path = route.path.format(**sample.get("path", {}))
    r = client.request(
        route.method, url(path), json=sample.get("json"), params=sample.get("params"), headers=sample.get("user", DANA)
    )
    expected = sample.get("expect", route.status)
    assert r.status_code == expected, r.text
    if r.status_code < 300 and route.response is not None:
        body = r.json()
        model = route.response
        if route.response_list:
            assert isinstance(body, list) and body
            model.model_validate(body[0])
        else:
            model.model_validate(body)
