"""Random selection among safe episodes and audit-only drift inputs."""

from random import SystemRandom
from typing import Any

from .models import AuditSample
from .statistics.drift import detect_drift


def select_audit(*, judged_safe: bool, fraction: float, rng: Any = None) -> bool:
    """Draw before human review; persist the decision and inclusion probability."""
    if not 0 < fraction <= 1:
        raise ValueError("Audit fraction must be in (0, 1]")
    return bool(judged_safe and (rng or SystemRandom()).random() < fraction)


def audit_drift(samples: tuple[AuditSample, ...], *, baselines: dict[str, float],
                cost_upper_bound: float | None = None, **settings: Any) -> dict:
    """Monitor completed independent audit clusters under predeclared baselines."""
    if len({s.function_id for s in samples}) > 1:
        raise ValueError("Monitor one function identity at a time")
    if list(samples) != sorted(samples, key=lambda s: s.timestamp):
        raise ValueError("Audit episodes must arrive in chronological order")
    rows = [{"episode_id": s.episode_id, "cluster": s.cluster, "judged_safe": s.judged_safe,
             "audit_selected": s.selected_for_audit, "audit_probability": s.inclusion_probability,
             "human_reviewed": s.human_reviewed, "attempted": dict(s.attempted), "cost": s.cost}
            for s in samples]
    return detect_drift(rows, baselines=baselines, cost_upper_bound=cost_upper_bound, **settings)
