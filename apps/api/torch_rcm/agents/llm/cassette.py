"""Cassettes: record and strictly replay Messages API conversations (07 §4.3).

Principle: the model proposes; code gates and executes. Tests and the deterministic eval never call the API:
they replay cassettes. A cassette is one JSONL file:

    {"type": "header", "v": 1, "synthetic": bool, "recorded_at": "...", "name": "...", "hash_mode": "full"|"structure",
     "key": {"agent", "situation_key", "system_sha", "tools_sha", "model", "effort", "thinking"}}
    {"type": "call", "subject_id": "clm_4744", "purpose": "plan", "seq": 0, "request_hash": "sha256:…",
     "response": {<Messages API response>}}
    …

- **Key.** Every field of `key` must match the live request exactly (`CassetteMiss` otherwise). The key holds
  `system_sha` and `tools_sha`, so a prompt or schema edit always misses; no version to bump.
- **Request hash.** `full` (recorded cassettes) hashes the canonical JSON of the whole `messages` list.
  `structure` (hand-authored, `synthetic: true` cassettes) hashes the conversation skeleton: roles, block
  types, tool names and inputs, tool_use ids and `is_error` flags, but not the text of user turns. A synthetic
  cassette therefore still misses if the planner sent different reads, a repair turn, or a different model.
- `RecordingClient` wraps the live `LlmClient` and appends; `record_canonical()` is `torch cassette record`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from torch_rcm.agents.llm.client import (
    CallMeta,
    LlmCallRecord,
    LlmClient,
    LlmResponse,
    call_record,
    request_pin,
)
from torch_rcm.agents.tools.schemas import canonical_json, sha
from torch_rcm.agents.types import AgentKind

CASSETTE_VERSION = 1
KEY_FIELDS: tuple[str, ...] = ("agent", "situation_key", "system_sha", "tools_sha", "model", "effort", "thinking")
HashMode = Literal["full", "structure"]
CANONICAL_DIR = Path(__file__).resolve().parents[3] / "cassettes"


class CassetteMiss(Exception):  # noqa: N818 - the spec's name
    """No recording matches this request. The planner falls back (labelled) and the test prints why."""

    reason = "cassette_miss"


def cassette_key(meta: CallMeta, body: Mapping[str, Any]) -> dict[str, Any]:
    return {"agent": meta.agent, "situation_key": meta.situation_key, **request_pin(body)}


def skeleton(messages: Iterable[Mapping[str, Any]]) -> list[Any]:
    """The shape of a conversation without the text of user turns (see module doc)."""
    out: list[Any] = []
    for m in messages:
        content = m.get("content")
        blocks = [{"type": "text"}] if isinstance(content, str) else list(content or [])
        shaped: list[Any] = []
        for b in blocks:
            kind = b.get("type")
            if kind == "tool_use":
                shaped.append(["tool_use", b.get("id"), b.get("name"), b.get("input")])
            elif kind == "tool_result":
                shaped.append(["tool_result", b.get("tool_use_id"), bool(b.get("is_error", False))])
            else:
                shaped.append([kind])
        out.append([m.get("role"), shaped])
    return out


def request_hash(messages: Sequence[Mapping[str, Any]], mode: HashMode) -> str:
    payload: Any = messages if mode == "full" else skeleton(messages)
    return "sha256:" + sha(payload)


# ---------------------------------------------------------------- file format


@dataclass
class Cassette:
    path: Path
    header: dict[str, Any]
    calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def key(self) -> dict[str, Any]:
        return dict(self.header["key"])

    @property
    def synthetic(self) -> bool:
        return bool(self.header.get("synthetic"))

    @property
    def hash_mode(self) -> HashMode:
        return self.header.get("hash_mode", "structure" if self.synthetic else "full")  # type: ignore[no-any-return]

    @classmethod
    def load(cls, path: Path) -> Cassette:
        lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not lines or lines[0].get("type") != "header":
            raise ValueError(f"{path}: first line must be the header")
        header, calls = lines[0], lines[1:]
        if header.get("v") != CASSETTE_VERSION:
            raise ValueError(f"{path}: cassette version {header.get('v')} (expected {CASSETTE_VERSION})")
        missing = [k for k in KEY_FIELDS if k not in header.get("key", {})]
        if missing:
            raise ValueError(f"{path}: header key lacks {missing}")
        return cls(path=path, header=header, calls=calls)

    def dump(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        rows = [self.header, *self.calls]
        self.path.write_text("".join(canonical_json(r) + "\n" for r in rows), encoding="utf-8")

    def find(self, subject_id: str, purpose: str, seq: int) -> dict[str, Any] | None:
        return next(
            (c for c in self.calls if c["subject_id"] == subject_id and c["purpose"] == purpose and c["seq"] == seq),
            None,
        )


def load_dir(path: Path) -> list[Cassette]:
    return [Cassette.load(p) for p in sorted(path.glob("*.jsonl"))]


def _key_diff(want: Mapping[str, Any], have: Mapping[str, Any]) -> str:
    return ", ".join(
        f"{k}: recorded {have.get(k)!r} ≠ request {want.get(k)!r}" for k in KEY_FIELDS if want.get(k) != have.get(k)
    )


# ---------------------------------------------------------------- replay


class CassetteClient:
    """Strict replay. Same interface as `LlmClient.messages_create`; emits the same `llm_calls` rows."""

    def __init__(
        self,
        source: Path | Iterable[Cassette],
        *,
        sink: Callable[[LlmCallRecord], None] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.cassettes = load_dir(source) if isinstance(source, Path) else list(source)
        self.sink = sink
        self.clock = clock
        self.records: list[LlmCallRecord] = []

    async def messages_create(self, meta: CallMeta, **body: Any) -> LlmResponse:
        want = cassette_key(meta, body)
        same_case = [
            c for c in self.cassettes if c.key["agent"] == meta.agent and c.key["situation_key"] == meta.situation_key
        ]
        if not same_case:
            raise CassetteMiss(f"no cassette for {meta.agent} · {meta.situation_key}")
        exact = [c for c in same_case if all(c.key[k] == want[k] for k in KEY_FIELDS)]
        if not exact:
            hint = (
                " (prompt edited? re-record with `torch cassette record`)"
                if any(c.key["system_sha"] != want["system_sha"] for c in same_case)
                else ""
            )
            raise CassetteMiss(
                f"key mismatch for {meta.agent} · {meta.situation_key}: {_key_diff(want, same_case[0].key)}{hint}"
            )
        for cas in exact:
            call = cas.find(meta.subject_id, meta.purpose, meta.seq)
            if call is None:
                continue
            got = request_hash(body["messages"], cas.hash_mode)
            if got != call["request_hash"]:
                raise CassetteMiss(
                    f"{cas.path.name}: request for {meta.subject_id} {meta.purpose}#{meta.seq} differs from the "
                    f"recording ({cas.hash_mode} hash {got} ≠ {call['request_hash']})"
                )
            resp = LlmResponse.from_api(call["response"])
            rec = call_record(meta, body, resp, attempt=1, latency_ms=0, at=self.clock() if self.clock else None)
            self.records.append(rec)
            if self.sink is not None:
                self.sink(rec)
            return resp
        raise CassetteMiss(
            f"no recorded call {meta.subject_id} {meta.purpose}#{meta.seq} in {[c.path.name for c in exact]}"
        )


# ---------------------------------------------------------------- record


class RecordingClient:
    """Wraps the live client and appends each call to one cassette file (full-hash, `synthetic: false`)."""

    def __init__(self, inner: LlmClient, path: Path, *, recorded_at: str, name: str | None = None) -> None:
        self.inner = inner
        self.path = path
        self.recorded_at = recorded_at
        self.name = name or path.stem
        self.cassette: Cassette | None = None

    async def messages_create(self, meta: CallMeta, **body: Any) -> LlmResponse:
        resp = await self.inner.messages_create(meta, **body)
        key = cassette_key(meta, body)
        if self.cassette is None:
            self.cassette = Cassette(
                path=self.path,
                header={
                    "type": "header",
                    "v": CASSETTE_VERSION,
                    "name": self.name,
                    "synthetic": False,
                    "recorded_at": self.recorded_at,
                    "hash_mode": "full",
                    "key": key,
                },
            )
        elif self.cassette.key != key:
            raise ValueError(f"{self.path.name}: one cassette holds one key; got {_key_diff(key, self.cassette.key)}")
        self.cassette.calls.append(
            {
                "type": "call",
                "subject_id": meta.subject_id,
                "purpose": meta.purpose,
                "seq": meta.seq,
                "request_hash": request_hash(body["messages"], "full"),
                "response": resp.raw,
            }
        )
        self.cassette.dump()
        return resp


# ---------------------------------------------------------------- authoring synthetic cassettes


def synthetic_cassette(
    path: Path,
    *,
    name: str,
    key: Mapping[str, Any],
    conversations: Mapping[str, list[dict[str, Any]]],
    purpose: str,
    recorded_at: str,
    note: str,
    first_user: Callable[[str], dict[str, Any]] | None = None,
) -> Cassette:
    """Build a `synthetic: true` cassette from hand-written responses, one list per subject.

    The structural request hash of call n is computed from the responses before it, assuming every tool_use
    got a successful tool_result (the happy path the cassette encodes).
    """
    cas = Cassette(
        path=path,
        header={
            "type": "header",
            "v": CASSETTE_VERSION,
            "name": name,
            "synthetic": True,
            "recorded_at": recorded_at,
            "hash_mode": "structure",
            "note": note,
            "key": dict(key),
        },
    )
    for subject_id, responses in conversations.items():
        messages: list[dict[str, Any]] = [first_user(subject_id) if first_user else {"role": "user", "content": "case"}]
        for seq, resp in enumerate(responses):
            cas.calls.append(
                {
                    "type": "call",
                    "subject_id": subject_id,
                    "purpose": purpose,
                    "seq": seq,
                    "request_hash": request_hash(messages, "structure"),
                    "response": resp,
                }
            )
            messages.append({"role": "assistant", "content": resp["content"]})
            results = [
                {"type": "tool_result", "tool_use_id": b["id"], "content": "…"}
                for b in resp["content"]
                if b.get("type") == "tool_use"
            ]
            messages.append({"role": "user", "content": results})
    return cas


def restamp_synthetic(path: Path, key: Mapping[str, Any]) -> Cassette:
    """Re-key a hand-authored cassette after a deliberate prompt/schema edit. Refuses recorded cassettes."""
    cas = Cassette.load(path)
    if not cas.synthetic:
        raise ValueError(f"{path.name} is a recording; re-record it instead of restamping")
    cas.header["key"] = {k: key[k] for k in KEY_FIELDS}
    cas.dump()
    return cas


# ---------------------------------------------------------------- `torch cassette record`


@dataclass(frozen=True)
class CanonicalCassette:
    name: str
    agent: AgentKind
    subject_ids: tuple[str, ...]
    purpose: Literal["plan", "draft"]
    at: str  # the world time the runs happen at (the seed's clock is advanced to it first)


CANONICAL: tuple[CanonicalCassette, ...] = (
    CanonicalCassette(
        "clm_4821_group", "followup", ("clm_4821", "clm_4836", "clm_4840"), "plan", "2026-10-28T10:40:00-04:00"
    ),
    CanonicalCassette("clm_4744", "followup", ("clm_4744",), "plan", "2026-10-28T10:40:00-04:00"),
    CanonicalCassette("clm_4709", "followup", ("clm_4709",), "plan", "2026-10-28T10:40:00-04:00"),
    CanonicalCassette("clm_4731", "followup", ("clm_4731",), "plan", "2026-10-28T10:40:00-04:00"),
    CanonicalCassette("clm_4796_appeal", "appeals", ("clm_4796",), "draft", "2026-10-30T07:10:00-04:00"),
)


def record_canonical(
    scenario: str = "canonical", *, out_dir: Path | None = None, only: Iterable[str] = ()
) -> list[Path]:
    """Re-record the canonical cassettes against the live API (needs `ANTHROPIC_API_KEY`). Entry point for
    `torch cassette record`. Each case runs on a fresh copy of the seeded world at the cassette's time."""
    import asyncio

    from torch_rcm.agents.config import AgentConfig

    cfg = AgentConfig.from_env()
    if cfg.anthropic_api_key is None:
        raise SystemExit("set ANTHROPIC_API_KEY to record cassettes")
    if scenario != "canonical":
        raise SystemExit(f"only the canonical scenario has cassettes (got {scenario!r})")
    out = out_dir or CANONICAL_DIR / scenario
    wanted = set(only)
    written: list[Path] = []
    for spec in CANONICAL:
        if wanted and spec.name not in wanted:
            continue
        written.append(asyncio.run(_record_one(spec, cfg, out)))
    return written


def record(scenario: str = "canonical", agent: str | None = None) -> int:
    """`torch cassette record [--scenario] [--agent]` (torch_rcm/agents/cli.py looks this name up). Exit code."""
    only = [c.name for c in CANONICAL if agent is None or c.agent == agent]
    if not only:
        return 0
    for path in record_canonical(scenario, only=only):
        print(f"recorded {path}")
    return 0


async def _record_one(spec: CanonicalCassette, cfg: Any, out: Path) -> Path:
    import shutil
    import tempfile

    from torch_rcm.agents.case import build_case
    from torch_rcm.agents.planner.base import EvidenceSet
    from torch_rcm.agents.planner.live import LivePlanner, registry_reader
    from torch_rcm.agents.planner.scripted import ScriptedPlanner
    from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain
    from torch_rcm.agents.tools.registry import ToolRegistry
    from torch_rcm.agents.types import Subject
    from torch_rcm.config import Settings
    from torch_rcm.db.store import Store
    from torch_rcm.runtime import Runtime
    from torch_rcm.scheduler.registry import Registry
    from torch_rcm.seed.canonical import build
    from torch_rcm.seed.persist import persist

    at = datetime.fromisoformat(spec.at)
    tmp = Path(tempfile.mkdtemp(prefix="torch-cassette-"))
    try:
        db = tmp / "torch.db"
        world = build()
        store = Store(db)
        persist(store, world)
        store.close()
        rt = Runtime.open(Settings(db_url=f"sqlite:///{db}"), reg=Registry())
        if at > rt.clock.now():
            await rt.scheduler.run_due(at)
        sim = SimWorld(rt.world)
        dom = StoreDomain(rt.store, sim)
        registry = ToolRegistry(sim)
        live = LlmClient(cfg, clock=lambda: at)
        path = out / f"{spec.name}.jsonl"
        if path.exists():
            path.unlink()
        recorder = RecordingClient(live, path, recorded_at=at.isoformat(), name=spec.name)
        for subject_id in spec.subject_ids:
            run_id = f"run_cassette_{subject_id}"
            case = build_case(
                dom, run_id=run_id, agent=spec.agent, subject=Subject(kind="claim", id=subject_id), now=at
            )
            evidence = EvidenceSet(case.evidence)
            reader = registry_reader(registry, case, run_id=run_id)
            planner = LivePlanner(client=recorder, cfg=cfg)
            if spec.purpose == "plan":
                await planner.plan(case, reader, evidence)
            else:
                plan = await ScriptedPlanner().plan(case, reader, evidence)
                await planner.draft(case, plan, "appeal_letter", evidence)
        rt.store.close()
        return path
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


__all__ = [
    "CANONICAL",
    "CANONICAL_DIR",
    "KEY_FIELDS",
    "Cassette",
    "CassetteClient",
    "CassetteMiss",
    "RecordingClient",
    "cassette_key",
    "load_dir",
    "record",
    "record_canonical",
    "request_hash",
    "restamp_synthetic",
    "skeleton",
    "synthetic_cassette",
]
