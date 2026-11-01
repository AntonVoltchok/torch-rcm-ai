"""Guardrails: the text guard, the injection detector, world-content wrapping and rep-call bounds.

Principle: the model proposes; code gates and executes. Nothing in this module trusts text: payer
portals, IVR transcripts and clinical notes are untrusted world content, and anything an agent wrote
for a payer or patient must cite evidence for every fact before it can even be *eligible* to send
(it still goes to a person unless an owner-signed text rule covers it — policy row 9).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from html import escape

from torch.agents.types import Draft, Evidence, GuardResult

# ---------------------------------------------------------------- rep-call bounds (07 §5.2)

MAY_AGREE_TO: frozenset[str] = frozenset({"reprocessing", "send_records", "resubmit", "confirm_status", "send_835"})


def out_of_bounds_offers(offers: Iterable[str]) -> list[str]:
    """Offers a simulated rep made that Torch may not accept (refund offset, recoupment, write-off)."""
    return [o for o in offers if o not in MAY_AGREE_TO]


# ---------------------------------------------------------------- injection detector (07 §5.5)

_INJECTION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bignore (all |any )?(previous|prior|above|earlier) (instructions|messages|rules)",
        r"(^|\s|\[|<)(system|assistant|developer)\s*:",
        r"</?\s*(system|assistant|user|world_content|tool_result|instructions)\b",
        r"\byou are (now )?(an?|the) (ai|assistant|agent|model|llm)\b",
        r"\b(as an|dear) (ai|assistant|agent|language model)\b",
        r"\b(submit_plan|submit_result|submit_draft|void_claim|write_off|discretionary_refund)\b",
        r"\b(disregard|override) (your|the) (rules|policy|instructions)",
        r"\bnew instructions\b",
    )
)


def looks_like_injection(text: str) -> bool:
    """Cheap and deliberately over-eager: a false positive only adds a warning to a human's card."""
    return any(p.search(text) for p in _INJECTION_PATTERNS)


# ---------------------------------------------------------------- world-content wrapping (07 §3.2)


def wrap_world_content(ev: Evidence) -> str:
    """Wrap untrusted text so it is labelled and cannot close its own tag (`<`, `>`, `&`, quotes escaped)."""
    attrs = {
        "source": ev.source,
        "kind": ev.kind,
        "evidence_id": ev.id,
        "captured_at": ev.captured_at.isoformat(),
        "trust": "untrusted",
    }
    if ev.suspicious:
        attrs["suspicious"] = "instructions_detected"
    head = " ".join(f'{k}="{escape(v, quote=True)}"' for k, v in attrs.items())
    return f"<world_content {head}>{escape(ev.excerpt, quote=False)}</world_content>"


# ---------------------------------------------------------------- text guard (07 §5.3)

_MONEY = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{2})?)")
_CDT = re.compile(r"\bD\d{4}\b")
_TOOTH = re.compile(r"#\s?(\d{1,2})\b")
_DATE_US = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_NUMBER = re.compile(r"(?<![\w$#/.-])(\d+(?:\.\d+)?)(?![\w/-])")

_ATTESTATION = re.compile(r"\b(i|we) (hereby )?(certify|attest|swear)\b|(?<![\"“'])\bmedically necessary\b", re.I)
_PROMISE_OR_THREAT = re.compile(
    r"\b(we|torch) (will|shall) (pay|refund|cover)\b|\bguarantee(d)?\b|\bcollections?\b|\blegal action\b"
    r"|\bsent to an? (agency|attorney)\b",
    re.I,
)
_PATIENT_ID = re.compile(r"\bpat_[a-z0-9_]+\b")


def fact_tokens(text: str) -> set[str]:
    """Normalised facts in a text: money in cents, CDT codes, teeth, month/day dates, bare numbers."""
    tokens: set[str] = set()
    for m in _MONEY.finditer(text):
        tokens.add(f"$:{round(float(m.group(1).replace(',', '')) * 100)}")
    tokens |= {f"cdt:{m.group(0)}" for m in _CDT.finditer(text)}
    tokens |= {f"tooth:{int(m.group(1))}" for m in _TOOTH.finditer(text)}
    for m in _DATE_US.finditer(text):
        tokens.add(f"date:{int(m.group(1))}/{int(m.group(2))}")
    for m in _DATE_ISO.finditer(text):
        tokens.add(f"date:{int(m.group(2))}/{int(m.group(3))}")
    stripped = _DATE_ISO.sub(" ", _DATE_US.sub(" ", _TOOTH.sub(" ", _MONEY.sub(" ", _CDT.sub(" ", text)))))
    tokens |= {f"n:{float(m.group(1)):g}" for m in _NUMBER.finditer(stripped)}
    return tokens


def _source_tokens(excerpts: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for text in excerpts:
        toks = fact_tokens(text)
        out |= toks
        # a dollar amount or a tooth number in a source also licenses the bare number
        out |= {f"n:{int(t[2:]) / 100:g}" for t in toks if t.startswith("$:")}
        out |= {f"n:{t[6:]}" for t in toks if t.startswith("tooth:")}
    return out


def guard_draft(
    draft: Draft,
    run_evidence: dict[str, Evidence],
    structured_facts: Sequence[str],
    subject_patient_id: str | None,
) -> GuardResult:
    """Checks 2–4 of §5.3. `structured_facts` are code-rendered strings (claim number, DOS, lines).

    Passing makes text *eligible* only; policy row 9 still sends it to a person without a signed rule.
    """
    errors: list[str] = []
    for i, seg in enumerate(draft.segments):
        cited = [run_evidence[e] for e in seg.evidence_ids if e in run_evidence]
        unknown = [e for e in seg.evidence_ids if e not in run_evidence]
        if unknown:
            errors.append(f"segment {i}: cites evidence not in this run ({', '.join(unknown)})")
        if seg.fact_type in ("clinical", "financial") and not cited:
            errors.append(f"segment {i}: {seg.fact_type} statement cites no evidence")
        allowed = _source_tokens([e.excerpt for e in cited] + [e.title for e in cited] + list(structured_facts))
        missing = sorted(fact_tokens(seg.text) - allowed)
        if missing:
            errors.append(f"segment {i}: unsourced {', '.join(t.split(':', 1)[1] for t in missing)}")
        if _ATTESTATION.search(seg.text):
            errors.append(f"segment {i}: attestation language")
        if _PROMISE_OR_THREAT.search(seg.text):
            errors.append(f"segment {i}: payment promise or collection threat")
        others = {p for p in _PATIENT_ID.findall(seg.text) if p != subject_patient_id}
        if others:
            errors.append(f"segment {i}: mentions another patient ({', '.join(sorted(others))})")
    return GuardResult(ok=not errors, errors=tuple(errors))


# ---------------------------------------------------------------- terminal-tool protocol (07 §3.3)

TERMINAL_TOOL_NAMES: frozenset[str] = frozenset({"submit_plan", "submit_result", "submit_draft"})


def _tool_name(use: object) -> str:
    if isinstance(use, str):
        return use
    if isinstance(use, dict):
        return str(use.get("name", ""))
    return str(getattr(use, "name", ""))


def terminal_protocol_violation(tool_uses: Sequence[object]) -> bool:
    """True when one assistant turn sends a terminal tool alongside any other tool use (reads, or a second
    terminal). The loop answers every tool_use in that turn with `is_error` and asks for a repair.

    Accepts tool names, `{"name": ...}` dicts (API content blocks) or objects with `.name`.
    """
    names = [_tool_name(u) for u in tool_uses]
    terminals = [n for n in names if n in TERMINAL_TOOL_NAMES]
    return bool(terminals) and len(names) > 1
