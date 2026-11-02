"""HTTP contract tests: every endpoint over FastAPI's TestClient (httpx), plus "the app's operations equal the
contract table" and "openapi.snapshot.json is the app's document", so none of the three can drift."""

from __future__ import annotations

import asyncio
import json
import shutil
from collections.abc import Iterator
from functools import cache
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from torch_rcm.api.app import API_PREFIX, create_app
from torch_rcm.api.contract import ROUTES, Route, openapi_document
from torch_rcm.config import Settings
from torch_rcm.events import FIREHOSE, replay
from torch_rcm.scheduler.runner import Scheduler

DANA = {"X-Torch-User": "usr_dana"}
MORGAN = {"X-Torch-User": "usr_morgan"}


@pytest.fixture
def client(tmp_path: Path, template_db: Path) -> Iterator[object]:
    db = tmp_path / "api.db"
    shutil.copy(template_db, db)
    app = create_app(Settings(db_url=f"sqlite:///{db}", worker=False), start_worker=False)
    with TestClient(app) as c:
        yield c
        c.portal.call(scheduler(c).wait)  # no test leaves an advance running into teardown


def url(path: str) -> str:
    return API_PREFIX + path


def scheduler(client: TestClient) -> Scheduler:
    return client.app.state.runtime.scheduler  # type: ignore[attr-defined,no-any-return]  # Starlette's `app` is ASGIApp


def advance_to_end(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    """The demo's path: 202, then the snapshot once the background task has finished (awaited, never polled)."""
    r = client.post(url("/clock/advance"), json=body, headers=MORGAN)
    assert r.status_code == 202
    client.portal.call(scheduler(client).wait)
    snapshot = client.get(url(f"/clock/advance/{r.json()['advance_id']}"), headers=MORGAN)
    assert snapshot.status_code == 200
    return dict(snapshot.json())


@cache
def operations() -> dict[tuple[str, str], dict[str, Any]]:
    """The app's operations. Reads the OpenAPI document: `app.routes` holds opaque wrappers for included routers."""
    doc = create_app(Settings(db_url="sqlite://"), start_worker=False).openapi()
    return {
        (method.upper(), path.removeprefix(API_PREFIX)): op
        for path, ops in doc["paths"].items()
        for method, op in ops.items()
    }


def schema_name(schema: dict[str, Any]) -> str:
    return str(schema["$ref"]).rsplit("/", 1)[1]


def test_routes_match_the_contract_table() -> None:
    assert len(ROUTES) > 40
    assert set(operations()) == {(r.method, r.path) for r in ROUTES}


@pytest.mark.parametrize("route", ROUTES, ids=lambda r: f"{r.method} {r.path}")
def test_operation_matches_the_contract_table(route: Route) -> None:
    op = operations()[(route.method, route.path)]
    params = op.get("parameters", [])
    declared = {(p.name, p.location) for p in route.params if p.location != "path"}
    served = {(p["name"], p["in"]) for p in params if p["in"] != "path" and p["name"] != "x-torch-user"} - {
        ("Idempotency-Key", "header")
    }
    assert served == declared

    headers = {p["name"] for p in params if p["in"] == "header"}
    assert ("Idempotency-Key" in headers) is route.idempotent

    assert set(op["responses"]) - {"422"} == {str(route.status)}
    content = op["responses"][str(route.status)]["content"]
    if route.sse:
        assert set(content) == {"text/event-stream"}
    else:
        schema = content["application/json"]["schema"]
        assert route.response is not None
        assert schema_name(schema["items"] if route.response_list else schema) == route.response.__name__

    body = op.get("requestBody")
    if route.body is None:
        assert body is None
    else:
        schema = body["content"]["application/json"]["schema"]
        options = schema["anyOf"][:1] if route.body_optional else [schema]
        assert [schema_name(s) for s in options] == [route.body.__name__]
        assert bool(body.get("required")) is not route.body_optional


def test_snapshot_is_the_apps_document() -> None:
    snapshot = json.loads((Path(__file__).parents[1] / "openapi.snapshot.json").read_text())
    assert snapshot == json.loads(json.dumps(openapi_document())), "stale: run `make gen-api`"


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


def test_idempotency_key_header_reaches_the_service(client) -> None:  # type: ignore[no-untyped-def]
    item = url("/inbox/itm_4851:reject")
    first = client.post(item, json={"reason": "calling patient"}, headers={**DANA, "Idempotency-Key": "k1"})
    assert first.status_code == 200
    replay = client.post(item, json={"reason": "calling patient"}, headers={**DANA, "Idempotency-Key": "k1"})
    assert replay.status_code == 200 and replay.content == first.content
    reused = client.post(item, json={"reason": "different"}, headers={**DANA, "Idempotency-Key": "k1"})
    assert reused.status_code == 422 and reused.json()["error"]["code"] == "idempotency_key_reused"
    assert client.post(item, json={"reason": "calling patient"}, headers=DANA).status_code == 409


def sse_ids(text: str) -> list[str]:
    return [line.removeprefix("id: ") for line in text.splitlines() if line.startswith("id: ")]


def test_run_events_resume_after_a_stored_step_id(client) -> None:  # type: ignore[no-untyped-def]
    events = url("/runs/run_followup_4821_1028/events")
    full = sse_ids(client.get(events, headers=DANA).text)
    assert full == ["s0", "s1", "s2", "s3"]
    resumed = client.get(events, headers={**DANA, "Last-Event-ID": "s1"})
    assert resumed.status_code == 200 and sse_ids(resumed.text) == ["s2", "s3"]
    unknown = client.get(events, headers={**DANA, "Last-Event-ID": "not-an-id"})
    assert sse_ids(unknown.text) == full


def test_claims_query_params(client) -> None:  # type: ignore[no-untyped-def]
    r = client.get(url("/claims"), params={"status[]": "denied"}, headers=DANA).json()
    assert r["total"] == 5
    r = client.get(url("/claims"), params={"needs_action": "true"}, headers=DANA).json()
    assert (r["total"], r["total_cents"]) == (9, 826_500)
    detail = client.get(url("/claims/clm_4821"), headers=DANA).json()
    assert detail["claim"]["icn"] == "26299-041833" and detail["open_inbox_items"][0]["id"] == "itm_4821"


def test_clock_advance_runs_to_the_end(client) -> None:  # type: ignore[no-untyped-def]
    out = advance_to_end(client, {"to": "2026-10-29T07:10:00-04:00"})
    assert out["done"] is True and out["state"] == "done" and out["error"] is None
    assert out["now"] == "2026-10-29T07:10:00-04:00"
    tiles = {t["status"]: t["count"] for t in out["meta"]["counts"]["tiles"]}
    assert tiles["denied"] == 9
    assert advance_to_end(client, {"minutes": 30})["state"] == "done"


def test_clock_advance_is_async(client) -> None:  # type: ignore[no-untyped-def]
    """The 202 returns before the work: a second advance is refused and the clock reports the one in flight."""
    sched = scheduler(client)
    release = client.portal.call(asyncio.Event)
    run_due = sched.run_due

    async def gated(until, advance=None):  # type: ignore[no-untyped-def]
        await release.wait()
        return await run_due(until, advance)

    sched.run_due = gated  # type: ignore[method-assign]
    r = client.post(url("/clock/advance"), json={"minutes": 30}, headers=MORGAN)
    assert r.status_code == 202
    advance_id = r.json()["advance_id"]
    running = client.get(url(f"/clock/advance/{advance_id}"), headers=MORGAN).json()
    assert running["done"] is False and running["state"] == "running"
    assert client.get(url("/clock"), headers=MORGAN).json()["advancing"]["advance_id"] == advance_id
    second = client.post(url("/clock/advance"), json={"minutes": 30}, headers=MORGAN)
    assert second.status_code == 409 and second.json()["error"]["code"] == "advance_in_progress"
    client.portal.call(release.set)
    client.portal.call(sched.wait)
    assert client.get(url(f"/clock/advance/{advance_id}"), headers=MORGAN).json()["state"] == "done"


def test_failed_advance_reaches_the_firehose_and_releases_the_lock(client) -> None:  # type: ignore[no-untyped-def]
    sched = scheduler(client)
    run_due = sched.run_due

    async def boom(until, advance=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("handler exploded")

    sched.run_due = boom  # type: ignore[method-assign]
    out = advance_to_end(client, {"minutes": 30})
    assert out["done"] is True and out["state"] == "failed" and out["error"] == "RuntimeError: handler exploded"
    last = replay(sched.store, FIREHOSE, 0)[-1]
    assert last.event == "advance" and last.data["advance_id"] == out["advance_id"]
    assert (last.data["done"], last.data["state"], last.data["error"]) == (True, "failed", out["error"])
    sched.run_due = run_due  # type: ignore[method-assign]
    assert advance_to_end(client, {"minutes": 30})["state"] == "done"


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
    ("PATCH", "/settings/practice"): {"json": {"practice_cap_cents": 500_000}, "user": MORGAN},
    ("POST", "/proposals/{proposal_id}:accept"): {"path": {"proposal_id": "prop_delta_pa"}},
    ("POST", "/proposals/{proposal_id}:dismiss"): {"path": {"proposal_id": "prop_guardian_5mm"}},
    ("GET", "/eligibility/{appointment_id}"): {"path": {"appointment_id": "apt_1029_chen_j"}},
    ("GET", "/cash"): {"user": MORGAN},
    ("GET", "/remittances/{remittance_id}"): {"path": {"remittance_id": "rem_cigna_1028"}},
    ("POST", "/_world/reseed"): {"json": {"scenario": "canonical"}},
    ("POST", "/_world/inject"): {"json": {"event": "portal_outage", "payer_key": "delta_ny"}},
    ("POST", "/clock/advance"): {"json": {"minutes": 5}},
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
