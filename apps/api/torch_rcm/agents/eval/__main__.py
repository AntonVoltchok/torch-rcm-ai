"""`python -m torch_rcm.agents.eval [deterministic|live ...]` — exit non-zero on any mismatch."""

from __future__ import annotations

import sys

from torch_rcm.agents.eval.harness import MODES, Mode, run_eval


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    modes: tuple[Mode, ...] = tuple(a for a in args if a in MODES) or MODES  # type: ignore[misc]
    return run_eval(modes)


if __name__ == "__main__":
    sys.exit(main())
