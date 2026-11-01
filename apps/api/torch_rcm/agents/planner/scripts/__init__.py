"""Importing this package registers every deterministic script (one module per agent)."""

from torch_rcm.agents.planner.scripts import appeals, claims, eligibility, followup, posting

__all__ = ["appeals", "claims", "eligibility", "followup", "posting"]
