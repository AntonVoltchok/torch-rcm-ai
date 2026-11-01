"""`torch` CLI commands contributed by the agent runtime. `torch/cli.py` calls `register(cli)` when present.

- `torch eval` — delegates to `torch.agents.eval.run_eval` (prints "eval not available", exit 0, if absent).
  Added only when the host CLI has no `eval` command of its own.
- `torch cassette record [--scenario] [--agent]` — delegates to `torch.agents.llm.cassette.record`.

Typer is imported lazily so this module imports without it.
"""

from __future__ import annotations

import sys
from typing import Any

__all__ = ["record_cassettes_command", "register", "run_eval_command"]


def run_eval_command(echo: Any = print) -> int:
    try:
        from torch.agents.eval import run_eval
    except ImportError:
        echo("eval not available")
        return 0
    return int(run_eval(echo=echo) or 0)


def record_cassettes_command(scenario: str | None = None, agent: str | None = None, echo: Any = print) -> int:
    try:
        from torch.agents.llm import cassette  # type: ignore[attr-defined]
    except ImportError:
        echo("cassette recording not available (torch.agents.llm.cassette is not installed)")
        return 0
    record = getattr(cassette, "record", None) or getattr(cassette, "main", None)
    if record is None:
        echo("cassette recording not available (no record() in torch.agents.llm.cassette)")
        return 0
    kwargs = {k: v for k, v in (("scenario", scenario), ("agent", agent)) if v}
    return int(record(**kwargs) or 0)


def _names(app: Any) -> set[str]:
    names = {getattr(c, "name", None) or getattr(getattr(c, "callback", None), "__name__", "") for c in getattr(app, "registered_commands", [])}
    names |= {getattr(g, "name", "") for g in getattr(app, "registered_groups", [])}
    return {n.replace("_cmd", "").replace("_", "-") for n in names if n}


def register(app: Any) -> None:
    """Add the agent commands to the host typer app (idempotent per name)."""
    import typer

    have = _names(app)
    if "eval" not in have:

        @app.command("eval")
        def eval_cmd() -> None:
            """Replay the canonical scenario through the agents' eval harness."""
            sys.exit(run_eval_command(typer.echo))

    if "cassette" not in have:
        cassette_app = typer.Typer(no_args_is_help=True, help="LLM cassettes (record / replay).")

        @cassette_app.command("record")
        def record(
            scenario: str = typer.Option(None, "--scenario", help="Scenario to record (default: canonical)."),
            agent: str = typer.Option(None, "--agent", help="Only this agent."),
        ) -> None:
            """Re-record cassettes against the live API (needs ANTHROPIC_API_KEY)."""
            sys.exit(record_cassettes_command(scenario, agent, typer.echo))

        app.add_typer(cassette_app, name="cassette")
