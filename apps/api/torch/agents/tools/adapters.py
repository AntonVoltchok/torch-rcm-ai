"""World and domain adapters: the agents' only path into `torch.world` and the store.

Principle: the model proposes; code gates and executes. Everything here is called by code — read tools
(on the model's or a script's request, scope-checked first) and recipe steps (after policy said execute).

- `SimWorld.read(op, args)` never mutates the world. Each read is a WorldCallLog row (world's CallLog) and
  returns evidence candidates with provenance (`world_call_id`).
- `SimWorld.act(op, args, key)` performs one recipe step. The step's idempotency key is the WorldCallLog's
  UNIQUE `idempotency_key`: a repeat (crash, re-lease, double approval) returns the stored response and does
  nothing in the world — the same NEA# comes back.
- `StoreDomain` reads code facts for the case file and writes the few domain rows a run produces (inbox
  items, holds, evidence).

Where `torch.world` has no operation for a recipe step (request an 835, update a coverage order, post a
line), the adapter records the step through the world's own `CallLog.record` so provenance and idempotency
stay in one table. See docs/plans/agents-integration.md for the ops the world package may want to own.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Mapping
from datetime import date, datetime, timedelta
from typing import Any, cast

from torch.agents.ports import WorldCallResult, WorldRead, WorldUnavailable
from torch.agents.types import (
    AttachmentView,
    BaseRate,
    ClaimLineView,
    ClaimView,
    CoverageView,
    DenialView,
    Evidence,
    EvidenceCandidate,
    EvidenceKind,
    JsonValue,
    PatientView,
    PayerKey,
    PayerRuleView,
    PayerView,
    PriorProcedureView,
    Provenance,
    RuleScope,
    RuleView,
)
from torch.db.store import Store
from torch.domain.entities import (
    AckEvent,
    Appointment,
    Attachment,
    Claim,
    Coverage,
    FileEntry,
    Hold,
    Image,
    Patient,
    PatientLedgerEntry,
    PayerClaim,
    Practice,
    ProcedureLine,
    Remittance,
    Rule,
    Statement,
    User,
    Visit,
    WorldCallLog,
)
from torch.domain.entities import Evidence as EvidenceRow
from torch.domain.enums import (
    AttachmentKind,
    AttachmentSource,
    ClaimStatus,
    ClosedReason,
    ContactPref,
    CoverageOrder,
    EligibilityStatus,
    FileEntryKind,
    FileEntryState,
    GatheredBy,
    HoldReason,
    HoldSubject,
    LedgerEntryKind,
    RemitStatus,
    VerifiedVia,
)
from torch.domain.enums import EvidenceKind as DomainEvidenceKind
from torch.world.calendar import next_file_time
from torch.world.calllog import WorldUnavailableError
from torch.world.payers.profiles import PROFILES
from torch.world.sim import EDIT_LOCK, HoldWindowClosedError, World

#: An NEA# must be referenceable before the claim that cites it leaves (FastAttach indexing). A resubmission
#: that carries a fresh NEA# therefore takes the first file at least this far out — the 11:15 Delta file for
#: a 10:40 approval, as in the demo. (`Vyne.queue` has no lead parameter; see agents-integration.md.)
NEA_LEAD = timedelta(minutes=30)

#: PayerClaim states whose status text is a structured 277 category; anything else is free text.
_STRUCTURED: dict[str, str] = {
    "received": "in_process",
    "in_process": "in_process",
    "reprocessing": "in_process",
    "stuck": "in_process",
    "adjudicated": "finalized",
}
_UNTRUSTED_KINDS: frozenset[str] = frozenset(
    {"portal_screenshot", "ivr_transcript", "rep_call", "note_excerpt", "eob_pdf", "prior_eob"}
)
_DATE_TOKEN = re.compile(r"\b(\d{1,2}/\d{1,2})\b")


def _j(value: Any) -> JsonValue:
    """Coerce a world response into JSON-safe values (datetimes → ISO strings)."""
    if isinstance(value, dict):
        return {str(k): _j(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_j(v) for v in value]
    if isinstance(value, datetime | date):
        return value.isoformat()
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _s(args: Mapping[str, JsonValue], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    return value


def _list(args: Mapping[str, JsonValue], key: str) -> list[str]:
    value = args.get(key) or []
    if not isinstance(value, list):
        raise ValueError(f"{key} must be a list")
    return [str(v) for v in value]


def payer_short(key: str) -> str:
    return PROFILES[cast(Any, key)].short_name if key in {p.value for p in PROFILES} else key


# ═════════════════════════════════════════════════════════════════════════════════════════════ world


class SimWorld:
    """`WorldPort` over `torch.world.sim.World`."""

    def __init__(self, world: World) -> None:
        self.world = world
        self.store: Store = world.store
        self.clock = world.clock

    # ── helpers ─────────────────────────────────────────────────────────────────────────────────────────

    def _claim(self, claim_id: str) -> Claim:
        return self.store.require(Claim, claim_id)

    def _stored(self, key: str) -> WorldCallLog | None:
        rows = self.store.find(WorldCallLog, {"idempotency_key": key}, limit=1)
        return rows[0] if rows else None

    def _record(
        self,
        system: str,
        op: str,
        fn: Callable[[], dict[str, Any]],
        *,
        key: str | None,
        run_id: str | None,
        claim_id: str | None,
        mutation: bool,
        request: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.world.calls.record(
            system, op, fn, key=key, run_id=run_id, claim_id=claim_id, mutation=mutation, request=request
        )

    def _call_id(self, response: Mapping[str, Any], key: str | None = None) -> str | None:
        wc = response.get("world_call_id")
        if isinstance(wc, str):
            return wc
        if key:
            row = self._stored(key)
            return row.id if row else None
        return None

    # ── correspondence and structured status (also used by the case builder) ──────────────────────────

    def status_facts(self, claim_id: str) -> tuple[str | None, bool, str | None, str | None]:
        """(structured category, has free text, text, payer-claim state) for the payer's view on file."""
        pc = self.store.get(PayerClaim, claim_id)
        if pc is None:
            return None, False, None, None
        category = _STRUCTURED.get(pc.state)
        free = category is None and bool(pc.portal_note)
        return category, free, pc.portal_note, pc.state

    def _correspondence(self, claim: Claim, run_id: str | None) -> list[EvidenceCandidate]:
        _, _, text, state = self.status_facts(claim.id)
        if not text:
            return []
        now = self.clock.now()
        payer = payer_short(claim.payer_key.value)
        token = _DATE_TOKEN.search(text)
        when = f" {token.group(1)}" if token else ""
        if state == "consultant_review":
            kind: EvidenceKind = "ivr_transcript"
            title = f"{payer} IVR · claim status{when}"
            source = "payer_ivr"
        else:
            kind = "portal_screenshot"
            title = f"{payer} portal · correspondence{when}"
            source = "payer_portal"

        def read() -> dict[str, Any]:
            return {"text": text, "state": state}

        resp = self._record(
            f"payer:{claim.payer_key.value}",
            "portal.correspondence",
            read,
            key=None,
            run_id=run_id,
            claim_id=claim.id,
            mutation=False,
        )
        return [
            EvidenceCandidate(
                kind=kind,
                title=title,
                excerpt=text,
                captured_at=now,
                reference=claim.icn,
                source=source,
                untrusted=True,
                world_call_id=self._call_id(resp),
            )
        ]

    # ── reads ───────────────────────────────────────────────────────────────────────────────────────────

    def read(self, op: str, args: Mapping[str, JsonValue], *, run_id: str | None = None) -> WorldRead:
        try:
            return self._read(op, args, run_id)
        except WorldUnavailableError as exc:
            raise WorldUnavailable(str(exc), exc.retry_after) from exc

    def _read(self, op: str, args: Mapping[str, JsonValue], run_id: str | None) -> WorldRead:
        now = self.clock.now()
        if op == "pms.get_visit":
            resp = self.world.pms.get_visit(_s(args, "visit_id"), run_id=run_id)
            visit = resp["visit"]
            lines = resp["lines"]
            procs = ", ".join(f"{p['cdt']}{' #' + p['tooth'] if p.get('tooth') else ''}" for p in lines)
            ev = [
                EvidenceCandidate(
                    kind="pms_record",
                    title=f"PMS visit {visit['dos']} · {procs}",
                    excerpt=f"Visit {visit['dos']} · {procs} · note signed: {'yes' if visit.get('note_signed_by') else 'no'}",
                    captured_at=now,
                    reference=visit["id"],
                    source="pms",
                    world_call_id=self._call_id(resp),
                    data={"visit_id": visit["id"]},
                )
            ]
            if visit.get("note_text"):
                ev.append(
                    EvidenceCandidate(
                        kind="note_excerpt",
                        title=f"Clinical note {visit['dos']}",
                        excerpt=str(visit["note_text"]),
                        captured_at=now,
                        reference=visit["id"],
                        source="pms_note",
                        untrusted=True,
                        world_call_id=self._call_id(resp),
                        data={"visit_id": visit["id"]},
                    )
                )
            return WorldRead(data=cast(dict[str, JsonValue], _j(resp)), evidence=tuple(ev))
        if op == "pms.find_images":
            on_or_before = date.fromisoformat(_s(args, "on_or_before"))
            tooth = args.get("tooth")
            resp = self.world.pms.find_images(
                _s(args, "patient_id"),
                on_or_before,
                _list(args, "kinds"),
                tooth if isinstance(tooth, str) else None,
                run_id=run_id,
            )
            ev = [
                EvidenceCandidate(
                    kind="pms_record",
                    title=f"{img['kind'].upper()} x-ray{', tooth #' + img['tooth'] if img.get('tooth') else ''}",
                    excerpt=(
                        f"PMS imaging · {img['kind']}{' #' + img['tooth'] if img.get('tooth') else ''} · "
                        f"taken {img['taken_at'][:10]}"
                    ),
                    captured_at=now,
                    reference=img["id"],
                    source="pms",
                    world_call_id=self._call_id(resp),
                    data={
                        "image_id": img["id"],
                        "kind": img["kind"],
                        "tooth": img.get("tooth"),
                        "taken_on": img["taken_at"][:10],
                    },
                )
                for img in resp["images"]
            ]
            return WorldRead(data=cast(dict[str, JsonValue], _j(resp)), evidence=tuple(ev))
        if op == "pms.get_coverage":
            resp = self.world.pms.get_coverage(_s(args, "patient_id"), run_id=run_id)
            ev = [
                EvidenceCandidate(
                    kind="pms_record",
                    title=f"PMS coverage · {payer_short(c['payer_key'])} ({c['order']})",
                    excerpt=(
                        f"{payer_short(c['payer_key'])} {c['order']} · subscriber {c['subscriber_id']} · group "
                        f"{c['group_no']} · missing-tooth clause: {'yes' if c['plan'].get('missing_tooth_clause') else 'no'}"
                    ),
                    captured_at=now,
                    reference=c["id"],
                    source="pms",
                    world_call_id=self._call_id(resp),
                    data={"coverage_id": c["id"]},
                )
                for c in resp["coverages"]
            ]
            return WorldRead(data=cast(dict[str, JsonValue], _j(resp)), evidence=tuple(ev))
        if op == "rulebook.lookup":
            return self._rulebook(args, run_id)
        if op == "claim.get_history":
            return self._history(args, run_id)
        if op == "era.get_remittance":
            remit = self.store.require(Remittance, _s(args, "remittance_id"))
            return WorldRead(
                data={"remittance": cast(JsonValue, _j(remit.model_dump(mode="json")))},
                evidence=tuple(self._era_evidence(remit, None)),
            )
        raise ValueError(f"unknown read op {op}")

    def _rulebook(self, args: Mapping[str, JsonValue], run_id: str | None) -> WorldRead:
        key = _s(args, "payer_key")
        topic = _s(args, "topic")
        prof = PROFILES[cast(Any, key)]
        words = {
            "attachments": ("radiograph", "pa", "chart", "narrative", "attach"),
            "frequency": ("per tooth", "frequency", "months"),
            "alternate_benefit": ("alternate", "amalgam"),
            "missing_tooth": ("missing",),
            "cob": ("secondary", "cob", "primary"),
            "timely_filing": ("timely",),
            "appeal": ("appeal",),
            "prompt_pay": ("prompt", "reprocess"),
            "medical_necessity": ("pocket", "srp", "necess", "chart"),
        }.get(topic, ())
        texts = [r for r in prof.rules if any(w in r.lower() for w in words)]
        if topic == "prompt_pay" and prof.reprocessing_on_prompt_pay:
            texts.append("Honors NY Insurance Law §3224-a reprocessing requests on insured plans.")
        if not texts:
            texts = [f"No {topic.replace('_', ' ')} rule on file for {prof.short_name}."]

        def read() -> dict[str, Any]:
            return {"rules": texts}

        resp = self._record("rulebook", "rulebook.lookup", read, key=None, run_id=run_id, claim_id=None, mutation=False)
        now = self.clock.now()
        ev = [
            EvidenceCandidate(
                kind="policy_clause",
                title=f"{prof.short_name} rulebook · {topic.replace('_', ' ')}",
                excerpt=text,
                captured_at=now,
                reference=f"rb_{key}_{topic}_{i}",
                source="rulebook",
                world_call_id=self._call_id(resp),
            )
            for i, text in enumerate(texts)
        ]
        return WorldRead(data={"payer_key": key, "topic": topic, "rules": list(texts)}, evidence=tuple(ev))

    def _era_evidence(self, remit: Remittance, claim_id: str | None) -> list[EvidenceCandidate]:
        out: list[EvidenceCandidate] = []
        for line in remit.lines:
            if claim_id and line.claim_id != claim_id:
                continue
            adj = " · ".join(f"{a.group.value}-{a.code} ${a.cents / 100:,.2f}" for a in [*line.adj, *line.patient_adj])
            out.append(
                EvidenceCandidate(
                    kind="era_line",
                    title=f"{payer_short(remit.payer_key.value)} 835 · {remit.received_at:%m/%d} · {line.cdt}",
                    excerpt=(
                        f"{line.cdt} · billed ${line.billed / 100:,.2f} · allowed ${line.allowed / 100:,.2f} · "
                        f"paid ${line.paid / 100:,.2f}{' · ' + adj if adj else ''}{' · ' + line.rarc if line.rarc else ''}"
                    ),
                    captured_at=remit.received_at,
                    reference=remit.id,
                    source="era_835",
                    data={"remittance_id": remit.id, "remit_line_id": line.id},
                )
            )
        return out

    def _history(self, args: Mapping[str, JsonValue], run_id: str | None) -> WorldRead:
        claim = self._claim(_s(args, "claim_id"))
        include = set(_list(args, "include"))
        data: dict[str, JsonValue] = {"claim_id": claim.id}
        ev: list[EvidenceCandidate] = []
        if "acks" in include:
            acks = self.store.find(AckEvent, {"claim_id": claim.id}, order_by="at")
            data["acks"] = [f"{a.at:%m/%d %H:%M} {a.message}" for a in acks]
        if "attachments" in include:
            data["attachments"] = [
                f"{a.kind.value} · source {a.source.value}{' · NEA# ' + a.nea_number if a.nea_number else ''}"
                for a in claim.attachments
            ]
        if "remits" in include:
            remits = [
                r for r in self.store.all(Remittance) if any(line.claim_id == claim.id for line in r.lines)
            ]
            for r in remits:
                ev += self._era_evidence(r, claim.id)
            data["remits"] = [r.id for r in remits]
        if "correspondence" in include:
            corr = self._correspondence(claim, run_id)
            ev += corr
            data["correspondence"] = [c.excerpt for c in corr]
        if "payer_tooth_history" in include:
            pc = self.store.get(PayerClaim, claim.id)
            data["payer_tooth_history"] = cast(JsonValue, dict(pc.tooth_history) if pc else {})
        if "runs" in include:
            from torch.domain.entities import Run

            data["runs"] = [
                f"{r.started_at:%m/%d} {r.agent.value} · {r.result_summary}"
                for r in self.store.find(Run, {"claim_id": claim.id}, order_by="started_at")
            ]
        if "prior_eobs" in include:
            rows = self.store.find(EvidenceRow, {"claim_id": claim.id})
            data["prior_eobs"] = [e.id for e in rows if e.kind is DomainEvidenceKind.PRIOR_EOB]
        return WorldRead(data=data, evidence=tuple(ev))

    # ── acts (recipe steps) ─────────────────────────────────────────────────────────────────────────────

    def act(self, op: str, args: Mapping[str, JsonValue], idempotency_key: str, *, run_id: str) -> WorldCallResult:
        stored = self._stored(idempotency_key)
        if stored is not None:
            resp = stored.response
            return WorldCallResult(
                ok=stored.ok,
                data=cast(dict[str, JsonValue], _j(resp)),
                reference=cast(str | None, resp.get("reference")),
                replayed=True,
                requires_human=bool(resp.get("requires_human")),
                world_call_id=stored.id,
                evidence=tuple(self._evidence_for(op, resp, stored.id, args)),
            )
        try:
            resp = self._act(op, args, idempotency_key, run_id)
        except WorldUnavailableError as exc:
            raise WorldUnavailable(str(exc), exc.retry_after) from exc
        except HoldWindowClosedError as exc:
            return WorldCallResult(ok=False, error=f"file_departed: {exc}")
        call_id = self._call_id(resp, idempotency_key)
        return WorldCallResult(
            ok=True,
            data=cast(dict[str, JsonValue], _j({k: v for k, v in resp.items() if k != "world_call_id"})),
            reference=cast(str | None, resp.get("reference")),
            requires_human=bool(resp.get("requires_human")),
            world_call_id=call_id,
            evidence=tuple(self._evidence_for(op, resp, call_id, args)),
        )

    def _evidence_for(
        self, op: str, resp: Mapping[str, Any], call_id: str | None, args: Mapping[str, JsonValue]
    ) -> list[EvidenceCandidate]:
        now = self.clock.now()
        claim_id = args.get("claim_id")
        claim = self.store.get(Claim, claim_id) if isinstance(claim_id, str) else None
        payer = payer_short(claim.payer_key.value) if claim else "payer"
        if op in ("nea.upload", "nea.upload_packet"):
            nea = resp.get("nea_number")
            return [
                EvidenceCandidate(
                    kind="nea_attachment",
                    title=f"NEA FastAttach · NEA# {nea}",
                    excerpt=f"Uploaded {resp.get('kind', 'attachment')} · NEA# {nea}",
                    captured_at=now,
                    reference=str(nea),
                    source="nea",
                    world_call_id=call_id,
                )
            ]
        if op == "payer.check_status":
            return [
                EvidenceCandidate(
                    kind="ivr_transcript" if resp.get("channel") == "ivr" else "portal_screenshot",
                    title=f"{payer} {resp.get('channel', 'portal')} · claim status",
                    excerpt=str(resp.get("status_text", "")),
                    captured_at=now,
                    reference=cast(str | None, resp.get("reference")),
                    source=f"payer_{resp.get('channel', 'portal')}",
                    untrusted=True,
                    world_call_id=call_id,
                )
            ]
        if op == "payer.call_rep":
            return [
                EvidenceCandidate(
                    kind="rep_call",
                    title=f"{payer} rep call · ref {resp.get('reference')}",
                    excerpt=str(resp.get("transcript", "")),
                    captured_at=now,
                    reference=cast(str | None, resp.get("reference")),
                    source="payer_rep",
                    untrusted=True,
                    world_call_id=call_id,
                )
            ]
        return []

    def _act(self, op: str, args: Mapping[str, JsonValue], key: str, run_id: str) -> dict[str, Any]:  # noqa: PLR0912, PLR0915
        w = self.world
        now = self.clock.now()
        claim_id = args.get("claim_id")
        cid = claim_id if isinstance(claim_id, str) else None

        def rec(system: str, name: str, fn: Callable[[], dict[str, Any]], *, mutation: bool = True) -> dict[str, Any]:
            return self._record(
                system, name, fn, key=key, run_id=run_id, claim_id=cid, mutation=mutation, request=dict(args)
            )

        if op == "pms.get_image":
            image_id = _s(args, "image_id")

            def get_image() -> dict[str, Any]:
                img = self.store.require(Image, image_id)
                return {"reference": img.id, "kind": img.kind.value, "tooth": img.tooth, "taken_at": img.taken_at}

            return rec("pms", "pms.get_image", get_image, mutation=False)
        if op == "nea.upload":
            assert cid is not None
            return w.nea.upload(cid, _s(args, "image_id"), _s(args, "kind"), key=key, run_id=run_id)
        if op == "nea.upload_packet":
            assert cid is not None
            resp = w.nea.upload(cid, _s(args, "packet_ref"), _s(args, "kind"), key=key, run_id=run_id)
            return {**resp, "reference": resp.get("nea_number")}
        if op == "pms.write_claim_remarks":
            assert cid is not None
            text = _s(args, "text")

            def remarks() -> dict[str, Any]:
                claim = self._claim(cid)
                if claim.attachments:
                    last = claim.attachments[-1]
                    claim.attachments[-1] = last.model_copy(update={"note": text})
                    self.store.update(claim)
                return {"remarks": text, "reference": text}

            return rec("pms", "pms.write_claim_remarks", remarks)
        if op == "vyne.queue":
            assert cid is not None
            return self._queue(cid, args, key, run_id)
        if op == "pms.collect_records":
            assert cid is not None
            image_ids = _list(args, "image_ids")
            visit_ids = _list(args, "note_visit_ids")

            def collect() -> dict[str, Any]:
                images = [self.store.require(Image, i) for i in image_ids]
                visits = [self.store.require(Visit, v) for v in visit_ids]
                digest = hashlib.sha256(f"{cid}:{image_ids}:{visit_ids}".encode()).hexdigest()[:8]
                kind = images[0].kind.value if images and images[0].kind.value in AttachmentKind else "narrative"
                return {
                    "reference": f"pkt_{digest}",
                    "kind": kind,
                    "contents": [f"{i.kind.value} {i.taken_at:%m/%d/%Y}" for i in images]
                    + [f"chart note {v.dos:%m/%d/%Y}" for v in visits],
                }

            return rec("pms", "pms.collect_records", collect, mutation=False)
        if op == "payer.submit_records":
            assert cid is not None
            claim = self._claim(cid)
            resp = w.payer(claim.payer_key).receive_records(cid, key=key, run_id=run_id)
            return {**resp, "reference": args.get("nea_number")}
        if op == "payer.check_status":
            assert cid is not None
            claim = self._claim(cid)
            channel = _s(args, "channel")
            sim = w.payer(claim.payer_key)
            return rec(
                sim.system,
                f"{channel}.check_status",
                lambda: {
                    k: v
                    for k, v in sim.check_status(cid, "ivr" if channel == "ivr" else "portal", run_id=run_id).items()
                    if k != "world_call_id"
                },
                mutation=False,
            )
        if op == "payer.call_rep":
            assert cid is not None
            claim = self._claim(cid)
            return w.payer(claim.payer_key).call_rep(
                cid, _s(args, "topic"), _list(args, "asks"), key=key, run_id=run_id
            )
        if op == "payer.request_reprocessing":
            assert cid is not None
            claim = self._claim(cid)
            resp = w.payer(claim.payer_key).receive_records(cid, key=key, run_id=run_id)
            ref = f"RP-{now:%m%d}-{int(hashlib.sha256(key.encode()).hexdigest()[:6], 16) % 100000:05d}"
            return {**resp, "basis": args.get("basis"), "reference": ref}
        if op == "payer.request_835":
            claim = self._claim(_s(args, "claim_id"))
            sim = w.payer(claim.payer_key)

            def request_835() -> dict[str, Any]:
                nxt = sim.next_era_day(now.date())
                return {"requested": True, "expected_on": nxt, "reference": f"835REQ-{claim.number}-{now:%m%d}"}

            return rec(sim.system, "request_835", request_835)
        if op == "pms.update_claim_field":
            assert cid is not None
            field, value = _s(args, "field"), _s(args, "value")

            def update_field() -> dict[str, Any]:
                claim = self._claim(cid)
                cov = self.store.require(Coverage, claim.coverage_id)
                if field in ("subscriber_id", "group_no"):
                    setattr(cov, field, value)
                    self.store.update(cov)
                return {"field": field, "value": value, "reference": f"{field}={value}"}

            return rec("pms", "pms.update_claim_field", update_field)
        if op == "payer.check_eligibility":
            appt_id = _s(args, "appointment_id")

            def eligibility() -> dict[str, Any]:
                appt = self.store.require(Appointment, appt_id)
                covs = self.store.find(Coverage, {"patient_id": appt.patient_id})
                primary = next((c for c in covs if c.order is CoverageOrder.PRIMARY), None)
                if primary is not None:
                    primary.verified_at, primary.verified_via = now, VerifiedVia.PORTAL
                    self.store.update(primary)
                if appt.eligibility_status is not EligibilityStatus.ISSUE:
                    appt.eligibility_status = EligibilityStatus.VERIFIED
                    self.store.update(appt)
                remaining = primary.plan.remaining_max_cents if primary else 0
                return {
                    "reference": f"271-{now:%m%d}-{appt.id[-4:]}",
                    "remaining_max_cents": remaining,
                    "status": appt.eligibility_status.value,
                }

            return rec("payer:eligibility", "eligibility_271", eligibility)
        if op == "pms.post_payment":
            remittance_id = _s(args, "remittance_id")

            def post() -> dict[str, Any]:
                remit = self.store.require(Remittance, remittance_id)
                remit.status = RemitStatus.AUTO_POSTED
                self.store.update(remit)
                return {"posted_lines": len(remit.lines), "reference": remit.trace}

            return rec("pms", "pms.post_payment", post)
        if op == "pms.update_benefits":
            cov_id = _s(args, "coverage_id")

            def benefits() -> dict[str, Any]:
                cov = self.store.require(Coverage, cov_id)
                cov.verified_at = now
                self.store.update(cov)
                return {"coverage_id": cov.id, "reference": cov.id}

            return rec("pms", "pms.update_benefits", benefits)
        if op == "vyne.attach_narrative":
            assert cid is not None
            text = _s(args, "text")

            def narrative() -> dict[str, Any]:
                claim = self._claim(cid)
                claim.attachments.append(
                    Attachment(
                        id=f"att_{claim.number}_{len(claim.attachments) + 1}",
                        kind=AttachmentKind.NARRATIVE,
                        source=AttachmentSource.AGENT,
                        created_at=now,
                        note=text[:2000],
                    )
                )
                self.store.update(claim)
                return {"reference": f"narrative #{claim.number}", "chars": len(text)}

            return rec("vyne", "vyne.attach_narrative", narrative)
        if op == "vyne.build_corrected":
            assert cid is not None
            return rec("vyne", "vyne.build_corrected", lambda: self._corrected(cid, run_id, key))
        if op == "pms.update_coverage_order":
            patient_id, new_primary = _s(args, "patient_id"), _s(args, "new_primary_coverage_id")

            def reorder() -> dict[str, Any]:
                covs = self.store.find(Coverage, {"patient_id": patient_id})
                if new_primary not in {c.id for c in covs}:
                    raise ValueError(f"{new_primary} is not a coverage of {patient_id}")
                for c in covs:
                    c.order = CoverageOrder.PRIMARY if c.id == new_primary else CoverageOrder.SECONDARY
                    self.store.update(c)
                return {"primary": new_primary, "reference": f"primary={new_primary}"}

            return rec("pms", "pms.update_coverage_order", reorder)
        if op in ("pms.transfer_to_patient", "pms.refund_original_tender"):
            return rec("pms", op, lambda: self._ledger(op, args, now))
        if op == "patient.send_statement":
            patient_id = _s(args, "patient_id")

            def statement() -> dict[str, Any]:
                n = self.store.count(Statement) + 1
                st = Statement(
                    id=f"stmt_{patient_id.removeprefix('pat_')}_{now:%m%d}_{n}",
                    patient_id=patient_id,
                    claim_ids=[],
                    due_on=(now + timedelta(days=30)).date(),
                    sent_via=self.store.require(Patient, patient_id).contact_pref or ContactPref.TEXT,
                    sent_at=now,
                    amount_cents=0,
                )
                self.store.insert(st)
                return {"reference": st.id}

            return rec("patient", "patient.send_statement", statement)
        raise ValueError(f"unknown act op {op}")

    def _queue(self, claim_id: str, args: Mapping[str, JsonValue], key: str, run_id: str) -> dict[str, Any]:
        """`Vyne.queue` semantics plus the NEA lead: a claim citing a fresh NEA# takes a later file."""
        kind = FileEntryKind(_s(args, "kind"))
        lead = NEA_LEAD if args.get("cites_new_attachment") else timedelta(0)
        if lead == timedelta(0):
            return self.world.vyne.queue(claim_id, kind, by=run_id, key=key, run_id=run_id)

        def mutate() -> dict[str, Any]:
            claim = self._claim(claim_id)
            now = self.clock.now()
            file_time = next_file_time(now + max(lead, EDIT_LOCK), PROFILES[claim.payer_key].file_times)
            entry = FileEntry(
                id=f"fe_{claim.number}_{file_time:%m%d%H%M}",
                claim_id=claim.id,
                payer_key=claim.payer_key,
                file_time=file_time,
                kind=kind,
                state=FileEntryState.QUEUED,
                queued_at=now,
                queued_by=run_id,
                remarks=cast(str | None, args.get("remarks")),
            )
            claim.file_time = file_time
            if kind is not FileEntryKind.ORIGINAL and claim.status is ClaimStatus.DENIED:
                verb = "resubmit" if kind is FileEntryKind.RESUBMIT else "corrected"
                claim.in_flight = f"{verb} queued · leaves {file_time:%H:%M}"
            with self.store.tx():
                self.store.upsert(entry)
                self.store.update(claim)
            return {"file_entry_id": entry.id, "file_time": file_time.isoformat(), "reference": f"{file_time:%H:%M}"}

        return self._record(
            "vyne", "vyne.queue", mutate, key=key, run_id=run_id, claim_id=claim_id, mutation=True, request=dict(args)
        )

    def _corrected(self, claim_id: str, run_id: str, key: str) -> dict[str, Any]:
        original = self._claim(claim_id)
        number = int(self.store.scalar('SELECT MAX("number") FROM claims') or 0) + 1
        new = original.model_copy(
            update={
                "id": f"clm_{number}",
                "number": number,
                "status": ClaimStatus.READY,
                "frequency_code": 7,
                "parent_claim_id": original.id,
                "built_at": self.clock.now(),
                "sent_at": None,
                "file_time": None,
                "lines": [
                    line.model_copy(
                        update={
                            "id": f"cl_{number}_{i}",
                            "paid_cents": None,
                            "adj": [],
                            "patient_adj": [],
                            "patient_cents": None,
                        }
                    )
                    for i, line in enumerate(original.lines, 1)
                ],
                "denial": None,
                "paid_cents": None,
                "paid_at": None,
                "patient_resp_cents": None,
                "reason_text": "corrected claim (frequency 7)",
                "in_flight": None,
            }
        )
        with self.store.tx():
            self.store.insert(new)
            original.closed_reason, original.closed_at = ClosedReason.SUPERSEDED, self.clock.now()
            self.store.update(original)
        self.world.vyne.queue(new.id, FileEntryKind.CORRECTED, by=run_id, key=f"{key}:queue", run_id=run_id)
        return {"corrected_claim_id": new.id, "reference": f"#{number}"}

    def _ledger(self, op: str, args: Mapping[str, JsonValue], now: datetime) -> dict[str, Any]:
        claim_id = args.get("claim_id")
        claim = self.store.get(Claim, claim_id) if isinstance(claim_id, str) else None
        patient_id = args.get("patient_id") or (claim.patient_id if claim else None)
        assert isinstance(patient_id, str)
        cents_value = args.get("cents", 0)
        cents = int(cents_value) if isinstance(cents_value, int | float) else 0
        kind, sign, memo = {
            "pms.transfer_to_patient": (LedgerEntryKind.CHARGE, 1, "patient responsibility transferred"),
            "pms.refund_original_tender": (LedgerEntryKind.REFUND, 1, "refund to original tender"),
        }[op]
        n = self.store.count(PatientLedgerEntry) + 1
        entry = PatientLedgerEntry(
            id=f"led_agent_{now:%m%d%H%M}_{n:05d}",
            patient_id=patient_id,
            kind=kind,
            cents=sign * cents,
            on=now.date(),
            claim_id=claim.id if claim else None,
            memo=memo,
        )
        self.store.insert(entry)
        return {"reference": entry.id, "cents": cents}


# ═════════════════════════════════════════════════════════════════════════════════════════════ domain


def _domain_kind(kind: str) -> DomainEvidenceKind:
    return DomainEvidenceKind(kind)


class StoreDomain:
    """Code facts for the case file and the domain rows a run writes, over `torch.db.store.Store`."""

    def __init__(self, store: Store, world: SimWorld) -> None:
        self.store = store
        self.world = world

    # ── reads ───────────────────────────────────────────────────────────────────────────────────────────

    def practice(self) -> Practice:
        return self.store.all(Practice)[0]

    def claim_entity(self, claim_id: str) -> Claim:
        return self.store.require(Claim, claim_id)

    def claim_view(self, claim_id: str) -> ClaimView:
        c = self.claim_entity(claim_id)
        category, free, _, _ = self.world.status_facts(c.id)
        acks = self.store.find(AckEvent, {"claim_id": c.id}, order_by="-at", limit=1)
        if c.status is ClaimStatus.REJECTED and acks and acks[0].code:
            category = acks[0].code
        denial = None
        if c.denial is not None:
            group, _, carc = c.denial.carc.partition("-")
            remits = [r for r in self.store.all(Remittance) if any(line.claim_id == c.id for line in r.lines)]
            remit = max(remits, key=lambda r: r.received_at) if remits else None
            denial = DenialView(
                group=cast(Any, group),
                carc=carc,
                rarc=c.denial.rarc,
                line_id=c.lines[0].id if c.lines else None,
                decoded=c.denial.decoded,
                remittance_id=remit.id if remit else None,
                denied_on=remit.received_at.date() if remit else (c.paid_at.date() if c.paid_at else None),
            )
        return ClaimView(
            id=c.id,
            number=c.number,
            patient_id=c.patient_id,
            visit_id=c.visit_id or "",
            coverage_id=c.coverage_id,
            payer_key=cast(PayerKey, c.payer_key.value),
            status=c.status.value,
            dos=c.dos,
            billed_cents=c.billed_cents,
            sent_at=c.sent_at,
            icn=c.icn,
            rendering_provider_id=c.provider_id,
            lines=tuple(
                ClaimLineView(id=line.id, cdt=line.cdt, tooth=line.tooth, surface=line.surface, fee_cents=line.fee_cents)
                for line in c.lines
            ),
            attachments=tuple(
                AttachmentView(
                    id=a.id,
                    kind=a.kind.value,
                    source=cast(Any, a.source.value),
                    image_id=a.image_id,
                    nea_number=a.nea_number,
                    created_at=a.created_at,
                )
                for a in c.attachments
            ),
            denial=denial,
            timely_filing_due=c.timely_filing_due,
            status_category=category,
            has_free_text_status=free,
            location_id=c.location_id,
        )

    def stored_root_cause(self, claim_id: str) -> str | None:
        c = self.claim_entity(claim_id)
        return c.denial.root_cause.value if c.denial else None

    def patient(self, patient_id: str) -> PatientView:
        p = self.store.require(Patient, patient_id)
        return PatientView(id=p.id, first=p.first, last=p.last)

    def coverages(self, patient_id: str) -> list[CoverageView]:
        return [
            CoverageView(
                id=c.id,
                patient_id=c.patient_id,
                payer_key=cast(PayerKey, c.payer_key.value),
                order=cast(Any, c.order.value),
                subscriber_id=c.subscriber_id,
                group_no=c.group_no,
                plan_type="self_funded_erisa" if c.self_funded else "ppo",
                missing_tooth_clause=c.plan.missing_tooth_clause,
                verified_at=c.verified_at,
                verified_via=c.verified_via.value if c.verified_via else None,
            )
            for c in self.store.find(Coverage, {"patient_id": patient_id})
        ]

    def payer(self, key: str) -> PayerView:
        prof = PROFILES[cast(Any, key)]
        return PayerView(
            key=cast(PayerKey, key),
            name=prof.name,
            short=prof.short_name,
            file_times=tuple(prof.file_times),
            appeal_window_days=prof.appeal_window_days,
            timely_filing_days=prof.timely_filing_days,
        )

    def payer_rules(self, key: str) -> list[PayerRuleView]:
        prof = PROFILES[cast(Any, key)]
        out: list[PayerRuleView] = []
        if prof.requires_pa:
            out.append(
                PayerRuleView(
                    id=f"pr_{key}_pa",
                    payer_key=cast(PayerKey, key),
                    topic="attachments",
                    cdt_prefixes=tuple(prof.requires_pa),
                    text=next((r for r in prof.rules if "radiograph" in r.lower()), "PA required"),
                    requires_attachment="pa",
                )
            )
        if prof.perio_chart_required:
            out.append(
                PayerRuleView(
                    id=f"pr_{key}_perio",
                    payer_key=cast(PayerKey, key),
                    topic="attachments",
                    cdt_prefixes=tuple(prof.perio_chart_required),
                    text=next((r for r in prof.rules if "perio" in r.lower()), "perio chart required"),
                    requires_attachment="perio_chart",
                )
            )
        return out

    def provenance(self, claim_id: str) -> list[Provenance]:
        claim = self.claim_entity(claim_id)
        out: list[Provenance] = []
        for a in claim.attachments:
            taken = None
            if a.image_id:
                img = self.store.get(Image, a.image_id)
                taken = img.taken_at.date() if img else None
            actor = {"agent": "agent", "user": "user", "pms_imaging": "pms"}[a.source.value]
            out.append(
                Provenance(
                    actor=cast(Any, actor),
                    what=f"attached {a.kind.value}",
                    attachment_kind=a.kind.value,
                    attachment_date=taken,
                    at=a.created_at,
                )
            )
        return out

    def on_file_evidence(self, claim_id: str) -> list[Evidence]:
        rows = self.store.find(EvidenceRow, {"claim_id": claim_id}, order_by="id")
        return [self.to_evidence(e) for e in rows if e.run_id is None or e.run_id.startswith("run_")]

    @staticmethod
    def to_evidence(e: EvidenceRow) -> Evidence:
        return Evidence(
            id=e.id,
            kind=cast(Any, e.kind.value),
            title=e.title,
            excerpt=e.excerpt,
            captured_at=e.captured_at,
            reference=e.reference,
            uri=e.uri,
            source=e.source or "torch",
            untrusted=e.kind.value in _UNTRUSTED_KINDS,
            suspicious=e.suspicious,
            gathered_by=cast(Any, e.gathered_by.value),
            run_id=e.run_id,
            claim_id=e.claim_id,
            world_call_id=e.world_call_id,
            data=cast(dict[str, JsonValue], _j(e.data)),
        )

    def prior_procedures(self, patient_id: str, before: date) -> list[PriorProcedureView]:
        visits = {v.id: v for v in self.store.find(Visit, {"patient_id": patient_id})}
        out: list[PriorProcedureView] = []
        for vid, v in sorted(visits.items(), key=lambda kv: kv[1].dos):
            if v.dos >= before:
                continue
            for p in self.store.find(ProcedureLine, {"visit_id": vid}):
                out.append(
                    PriorProcedureView(
                        visit_id=vid, dos=v.dos, cdt=p.cdt, tooth=p.tooth, note_signed=v.note_signed_by is not None
                    )
                )
        return out

    def remittance(self, remittance_id: str) -> Remittance:
        return self.store.require(Remittance, remittance_id)

    def appointment_patient(self, appointment_id: str) -> str | None:
        appt = self.store.get(Appointment, appointment_id)
        return appt.patient_id if appt else None

    def image_ids(self, patient_id: str) -> list[str]:
        return [i.id for i in self.store.find(Image, {"patient_id": patient_id})]

    def remittance_ids(self, claim_id: str) -> list[str]:
        return [r.id for r in self.store.all(Remittance) if any(line.claim_id == claim_id for line in r.lines)]

    def rules(self) -> list[RuleView]:
        return [rule_view(r) for r in self.store.all(Rule)]

    def user_role(self, user_id: str | None) -> str | None:
        if not user_id:
            return None
        u = self.store.get(User, user_id)
        return u.role.value if u else None

    def user_name(self, user_id: str | None) -> str:
        if not user_id:
            return "system"
        u = self.store.get(User, user_id)
        if u is None:
            return user_id
        first, _, last = u.name.partition(" ")
        return f"{first} {last[:1]}." if last and not first.startswith("Dr") else u.name

    def hold_window_open(self, claim_id: str) -> bool:
        try:
            self.world.world.vyne.assert_editable(claim_id)
        except HoldWindowClosedError:
            return False
        return True

    # ── writes ──────────────────────────────────────────────────────────────────────────────────────────

    def save_evidence(self, ev: Evidence) -> None:
        if self.store.get(EvidenceRow, ev.id) is not None:
            return
        self.store.insert(
            EvidenceRow(
                id=ev.id,
                kind=_domain_kind(ev.kind),
                title=ev.title,
                excerpt=ev.excerpt,
                uri=ev.uri,
                captured_at=ev.captured_at,
                reference=ev.reference,
                suspicious=ev.suspicious,
                gathered_by=GatheredBy(ev.gathered_by),
                claim_id=ev.claim_id,
                run_id=ev.run_id,
                world_call_id=ev.world_call_id,
                source=ev.source,
                data=dict(ev.data),
            )
        )

    def create_hold(self, claim_id: str, reason: str, detail: str, run_id: str) -> str:
        hid = f"hold_{claim_id.removeprefix('clm_')}_{reason}"
        if self.store.get(Hold, hid) is None:
            claim = self.claim_entity(claim_id)
            self.store.insert(
                Hold(
                    id=hid,
                    subject=HoldSubject.CLAIM,
                    subject_id=claim_id,
                    reason=HoldReason(reason),
                    detail=detail or f"held by {run_id}",
                    held_since=self.world.clock.now(),
                    clears_when="the reason is resolved in the PMS",
                    owner_user_id="usr_dana",
                    timely_due=claim.timely_filing_due,
                )
            )
        return hid


def rule_view(r: Rule) -> RuleView:
    return RuleView(
        id=r.id,
        version=r.version,
        origin=cast(Any, r.origin.value),
        tier=cast(Any, int(r.tier)),
        action=r.action.value,
        label=r.label,
        scope=RuleScope(
            payer_key=cast(PayerKey | None, r.scope.payer_key.value if r.scope.payer_key else None),
            item_type=r.scope.item_type,
            max_cents=r.scope.max_cents,
        ),
        mode=cast(Any, r.mode.value),
        confidence_floor=r.confidence_floor,
        outcome_metric=cast(Any, r.outcome_metric.value),
        reverses_in=cast(Any, r.reverses_in.value),
        requires_owner_signoff=r.requires_owner_signoff,
        signed_by=r.signed_by,
        signed_at=r.signed_at,
        base_rate=BaseRate(n=r.base_rate.n, k=r.base_rate.k),
        covers_agent_text=r.action.value == "send_claim_agent_text",
    )
