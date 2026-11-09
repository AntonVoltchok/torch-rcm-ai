"""`torch` command line (typer): seed, openapi, advance, eval."""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer

from torch_rcm.config import get_settings
from torch_rcm.log import configure

cli = typer.Typer(no_args_is_help=True, add_completion=False, help="Torch demo API tooling.")


@cli.command()
def seed(
    force: Annotated[bool, typer.Option("--force", help="Destroy and reseed.")] = False,
    if_missing: Annotated[bool, typer.Option("--if-missing", help="Seed only when the database is empty.")] = False,
    scenario: Annotated[
        str | None,
        typer.Option(
            "--scenario", help="canonical | empty_inbox | portal_outage | observe_mode_day3 | dso_4000_claims"
        ),
    ] = None,
) -> None:
    """Build a scenario and write it to TORCH_DB_URL."""
    from torch_rcm.runtime import Runtime
    from torch_rcm.seed.persist import persist
    from torch_rcm.world.scenarios import build_scenario

    settings = get_settings()
    configure(settings.log_level)
    rt = Runtime.open(settings)
    if rt.is_seeded() and not force:
        if if_missing:
            typer.echo(f"seeded already ({settings.db_path}); skipping")
            return
        typer.echo("database already seeded; pass --force to reseed", err=True)
        raise typer.Exit(1)
    name = scenario or settings.scenario
    persist(rt.store, build_scenario(name))
    typer.echo(f"seeded {name} → {settings.db_path} · clock {rt.clock.now().isoformat()}")


@cli.command()
def openapi(
    out: Annotated[Path, typer.Option("--out", help="Write the OpenAPI JSON here.")] = Path("openapi.snapshot.json"),
) -> None:
    """Write the OpenAPI document (FastAPI's when installed, else the contract table's)."""
    from torch_rcm.api.contract import openapi_document

    doc = openapi_document()
    out.write_text(json.dumps(doc, indent=2, sort_keys=False) + "\n")
    typer.echo(f"wrote {out} · {len(doc['paths'])} paths · {len(doc['components']['schemas'])} schemas")


@cli.command()
def advance(
    to: Annotated[str, typer.Option("--to", help="ISO-8601 with offset, e.g. 2026-10-29T07:10:00-04:00")],
) -> None:
    """Run the scheduler up to `--to` (the same loop as POST /clock/advance)."""
    from torch_rcm.api.app import load_agents, wire_agent_runtime
    from torch_rcm.runtime import Runtime

    settings = get_settings()
    configure(settings.log_level)
    rt = Runtime.open(settings)
    if load_agents(settings):
        wire_agent_runtime(rt)
    target = datetime.fromisoformat(to)
    advance_row = rt.scheduler.begin_advance(target, "cli")
    result = asyncio.run(rt.scheduler.execute_advance(advance_row))
    for ev in result.events_fired:
        typer.echo(f"{ev['at'][:16]}  {ev['kind']:<20} {ev['summary']}")
    typer.echo(
        f"now {rt.clock.now().isoformat()} · {len(result.events_fired)} events · unhandled {result.skipped_unhandled}"
    )


@cli.command("eval")
def eval_cmd() -> None:
    """Replay the canonical scenario through the agents' eval harness (torch_rcm.agents.eval), when present."""
    try:
        from torch_rcm.agents.eval.__main__ import main as agents_eval
    except ImportError:
        typer.echo("torch_rcm.agents.eval is not installed in this build; nothing to evaluate (exit 0).")
        return
    sys.exit(agents_eval([]))


def _agents_commands() -> None:
    """torch_rcm.agents may add commands (e.g. `torch cassette record`) by exposing `register(cli)`."""
    try:
        from torch_rcm.agents.cli import register
    except ImportError:
        return
    register(cli)


def main() -> None:
    _agents_commands()
    cli()


if __name__ == "__main__":
    main()
