"""Eval harness (07 §7, `make eval`): canonical scenario through deterministic and live-cassette modes."""

from torch_rcm.agents.eval.harness import EvalReport, ModeResult, RunShape, evaluate, render, run_eval, run_scenario

__all__ = ["EvalReport", "ModeResult", "RunShape", "evaluate", "render", "run_eval", "run_scenario"]
