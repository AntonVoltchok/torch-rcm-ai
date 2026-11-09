"""Every total the web shows on Today's claims, Claims, Eligibility, Activity, Settings and Denials equals the rows it
summarises (d1-api-4, d1-final: the browser adds nothing). One test per total, over HTTP so the snapshot is the one the screen gets."""

from __future__ import annotations

import shutil
from collections import Counter
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from torch_rcm.api.app import API_PREFIX, create_app
from torch_rcm.clock import to_practice_tz
from torch_rcm.config import Settings
from torch_rcm.world.calendar import is_business_day

DANA = {"X-Torch-User": "usr_dana"}
MORGAN = {"X-Torch-User": "usr_morgan"}
LOCATIONS = (None, "loc_downtown", "loc_riverside")


@pytest.fixture
def client(tmp_path: Path, template_db: Path) -> Iterator[TestClient]:
    db = tmp_path / "api.db"
    shutil.copy(template_db, db)
    app = create_app(Settings(db_url=f"sqlite:///{db}", worker=False), start_worker=False)
    with TestClient(app) as c:
        yield c
        c.portal.call(c.app.state.runtime.scheduler.wait)  # type: ignore[attr-defined]


def get(client: TestClient, path: str, headers: dict[str, str] = DANA, **params: Any) -> dict[str, Any]:
    r = client.get(API_PREFIX + path, params={k: v for k, v in params.items() if v is not None}, headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


def day(at: str) -> date:
    return to_practice_tz(datetime.fromisoformat(at)).date()


# ── Today's claims ─────────────────────────────────────────────────────────────────────────────────────────


def test_ledger_totals_equal_the_rows(client: TestClient) -> None:
    led = get(client, "/ledger/today")
    t = led["totals"]
    for key, rows in (("sent", led["sent"]), ("leaving", led["leaving_next_file"]), ("held", led["held"])):
        assert t[key] == {"count": len(rows), "cents": sum(r["claim"]["billed_cents"] for r in rows)}, key
    assert t["not_billable"] == {
        "count": len(led["not_billable"]),
        "cents": sum(r["fee_cents"] for r in led["not_billable"]),
    }
    assert t["on_ledger"] == t["sent"]["count"] + t["leaving"]["count"] + t["held"]["count"]
    assert t["sent"] == {"count": 5, "cents": 132_000}  # the demo's "Sent today 5 · $1,320"


def test_ledger_files_partition_the_leaving_rows(client: TestClient) -> None:
    led = get(client, "/ledger/today")
    rows = {r["claim"]["id"]: r for r in led["leaving_next_file"]}
    ids = [i for f in led["files"] for i in f["claim_ids"]]
    assert sorted(ids) == sorted(rows) and len(ids) == len(set(ids))
    for f in led["files"]:
        assert f["count"] == len(f["claim_ids"])
        assert f["cents"] == sum(rows[i]["claim"]["billed_cents"] for i in f["claim_ids"])
        assert all(rows[i]["file_time"] == f["file_time"] for i in f["claim_ids"])
    assert sum(f["cents"] for f in led["files"]) == led["totals"]["leaving"]["cents"]
    times = [f["file_time"] for f in led["files"]]
    timed = [t for t in times if t is not None]
    assert timed == sorted(timed, key=datetime.fromisoformat) and times[len(timed) :] == [None] * (
        len(times) - len(timed)
    )
    assert led["files"], "the canonical Thursday has a file leaving"


# ── Claims ─────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("location", LOCATIONS)
def test_all_count_and_paid_tile_equal_the_lists(client: TestClient, location: str | None) -> None:
    strip = get(client, "/summary/strip", location_id=location)
    every = get(client, "/claims", limit=1, location_id=location)
    paid = get(client, "/claims", status="paid", limit=1, location_id=location)
    tile = next(t for t in strip["tiles"] if t["status"] == "paid")
    assert strip["all_count"] == every["total"]
    assert tile["count"] == strip["paid_month_count"] == paid["total"]
    assert strip["all_count"] == strip["open_count"] + strip["paid_month_count"]


def test_all_count_on_seed_and_search_finds_older_paid(client: TestClient) -> None:
    strip = get(client, "/summary/strip")
    assert (strip["all_count"], strip["open_count"], strip["paid_month_count"]) == (225, 107, 118)
    # A September-paid claim is out of the month-to-date list but a search for it finds it.
    older = get(client, "/claims", q="", limit=500)
    listed = {c["number"] for c in older["items"]}
    rt = client.app.state.runtime  # type: ignore[attr-defined]
    from torch_rcm.domain.entities import Claim

    sept = next(c for c in rt.store.all(Claim) if c.status.value == "paid" and c.paid_at and c.paid_at.month == 9)
    assert sept.number not in listed
    found = get(client, "/claims", q=f"#{sept.number}")
    assert sept.number in {c["number"] for c in found["items"]}


def test_meta_counts_after_a_mutation_equal_a_fresh_read(client: TestClient) -> None:
    r = client.post(API_PREFIX + "/inbox/itm_4733:approve", json={}, headers=DANA)
    assert r.status_code == 202, r.text
    counts = r.json()["meta"]["counts"]
    assert counts["all_count"] == get(client, "/claims", limit=1)["total"]
    client.portal.call(client.app.state.runtime.scheduler.wait)  # type: ignore[attr-defined]
    assert get(client, "/summary/strip")["all_count"] == get(client, "/claims", limit=1)["total"]


# ── Eligibility ────────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("on", [None, "2026-10-29", "2026-10-31"])
def test_eligibility_by_day_equals_the_rows(client: TestClient, on: str | None) -> None:
    el = get(client, "/eligibility", date=on)
    assert el["total"] == len(el["rows"]) == sum(d["count"] for d in el["by_day"])
    per = Counter((day(r["start"]), r["status"]) for r in el["rows"])
    days = [date.fromisoformat(d["date"]) for d in el["by_day"]]
    assert days == sorted(days) and len(days) == len(set(days))
    assert {day(r["start"]) for r in el["rows"]} <= set(days)
    for d in el["by_day"]:
        k = date.fromisoformat(d["date"])
        assert d["count"] == d["verified"] + d["issue"] + d["unverified"] + d["checking"]
        for s in ("verified", "issue", "unverified", "checking"):
            assert d[s] == per[(k, s)], (k, s)
        assert d["count"] > 0 or is_business_day(k) or k == date.fromisoformat(el["date"])


def test_eligibility_lists_an_empty_business_day(client: TestClient) -> None:
    el = get(client, "/eligibility")
    business = [d for d in el["by_day"] if is_business_day(date.fromisoformat(d["date"]))]
    assert len(business) >= 2  # the window spans business days, even one with nothing booked


# ── Activity ───────────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("params", [{}, {"agent": "followup"}, {"outcome": "awaiting"}, {"day": "2026-10-27"}])
def test_activity_by_day_equals_the_rows(client: TestClient, params: dict[str, str]) -> None:
    act = get(client, "/activity", **params)
    got = [(d["date"], d["count"]) for d in act["by_day"]]
    want: list[tuple[str, int]] = []
    for r in act["rows"]:
        k = day(r["at"]).isoformat()
        if want and want[-1][0] == k:
            want[-1] = (k, want[-1][1] + 1)
        else:
            want.append((k, 1))
    assert got == want


def test_activity_move_is_the_claims_move_for_the_viewer(client: TestClient) -> None:
    for who in (DANA, MORGAN):
        act = get(client, "/activity", headers=who)
        moves = {c["id"]: c["move"] for c in get(client, "/claims", headers=who, q="", limit=500)["items"]}
        with_claim = [r for r in act["rows"] if r["claim_id"]]
        assert with_claim
        for r in act["rows"]:
            if r["claim_id"] is None:
                assert r["move"] is None
            elif r["claim_id"] in moves:
                assert r["move"] == moves[r["claim_id"]], r["run_id"]


# ── Settings › Agents ──────────────────────────────────────────────────────────────────────────────────────


def test_rules_counts_equal_the_rows(client: TestClient) -> None:
    rules = get(client, "/rules", headers=MORGAN)
    for g in rules["tiers"]:
        assert g["count"] == len(g["rows"])
        assert g["ran_without_review_7d"] == sum(r["ran_without_review_7d"] for r in g["rows"])
        assert g["waiting"] == sum(r["waiting"] for r in g["rows"])
        if g["tier"] == 3:
            assert g["ran_without_review_7d"] == 0
    assert rules["rules_count"] == sum(len(g["rows"]) for g in rules["tiers"])
    assert rules["proposals_open"] == sum(
        1 for p in get(client, "/proposals", headers=MORGAN)["items"] if p["state"] == "open"
    )
    assert rules["changes_count"] == get(client, "/rules/changes", headers=MORGAN)["total"]


def test_preview_totals(client: TestClient) -> None:
    rules = get(client, "/rules", headers=MORGAN)
    for g in rules["tiers"]:
        for row in g["rows"]:
            for mode in ("auto", "ask"):
                p = get(client, "/settings/preview", headers=MORGAN, rule_id=row["rule"]["id"], mode=mode)
                assert p["held_total"] == sum(p["held_by_root_cause"].values())
                assert p["before_holds"] == p["would_run"] + p["held_total"]
                assert p["net_change"] == p["would_run"] - p["baseline_would_run"]


def test_digest_is_this_weeks(client: TestClient) -> None:
    from torch_rcm.domain.entities import InboxItem, RuleChange
    from torch_rcm.readmodels.activity import week_start

    rt = client.app.state.runtime  # type: ignore[attr-defined]
    out = get(client, "/rules/changes", headers=MORGAN)
    d = out["digest"]
    today = rt.clock.now().date()
    monday = week_start(today)
    assert d["period_start"] == monday.isoformat()
    assert (date.fromisoformat(d["sends_on"]) - monday).days == 7
    assert d["changes"] == sum(1 for c in rt.store.all(RuleChange) if c.at.date() >= monday)
    assert d["awaiting_signoff"] == sum(
        1 for i in rt.store.all(InboxItem) if i.kind.value == "owner_signoff" and i.state.value == "open"
    )
    week = [c for c in out["items"] if day(c["at"]) >= monday]
    assert d["items_run"] == sum(c["items_affected_since"] for c in week)
    assert (d["changes"], d["items_run"], d["awaiting_signoff"]) == (2, 2, 0)


# ── Denials ────────────────────────────────────────────────────────────────────────────────────────────────

_REASON = {"CO-16": "doc", "CO-119": "freq", "CO-22": "cob", "CO-29": "tf", "CO-50": "med_nec"}


@pytest.mark.parametrize("headers", [DANA, MORGAN])
def test_denials_matrix_equals_the_rows(client: TestClient, headers: dict[str, str]) -> None:
    out = get(client, "/denials", headers=headers)
    m = out["matrix"]
    rows = [r for g in out["groups"] for r in g["rows"]]
    keys = [c["key"] for c in m["columns"]]
    assert keys == ["doc", "freq", "cob", "tf", "med_nec", "other"]
    want: Counter[tuple[str, str]] = Counter()
    for r in rows:
        if not r["carc"].startswith("PR-"):
            want[(r["claim"]["payer"]["key"], _REASON.get(r["carc"], "other"))] += 1
    got: Counter[tuple[str, str]] = Counter()
    for p in m["payers"]:
        assert [c["reason"] for c in p["cells"]] == keys
        assert p["total"] == sum(c["count"] for c in p["cells"]) > 0
        for c in p["cells"]:
            if c["count"]:
                got[(p["payer"]["key"], c["reason"])] += c["count"]
    assert got == want
    assert [c["reason"] for c in m["totals"]] == keys
    for c in m["totals"]:
        assert c["count"] == sum(n for (_, k), n in want.items() if k == c["reason"])
    assert m["total"] == sum(want.values()) == sum(p["total"] for p in m["payers"])
    assert m["excluded"] == sum(1 for r in rows if r["carc"].startswith("PR-"))
    assert m["total"] + m["excluded"] == out["total"] == len(rows)
    order = [(-p["total"], p["payer"]["short_name"]) for p in m["payers"]]
    assert order == sorted(order)


def test_denials_matrix_on_the_seed(client: TestClient) -> None:
    m = get(client, "/denials")["matrix"]
    delta = next(p for p in m["payers"] if p["payer"]["key"] == "delta_ny")
    assert {c["reason"]: c["count"] for c in delta["cells"] if c["count"]} == {"doc": 3, "freq": 1}
    assert m["excluded"] == 1  # #4611 PR-119, annual maximum met
