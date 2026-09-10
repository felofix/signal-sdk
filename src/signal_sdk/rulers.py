"""Rulers: how performance is measured.

A grader judges one trial. A ruler turns the rows of many trials into one
estimate with a 95% interval: accuracy, a cost, pass^k, agreement between
raters. Rulers are the vocabulary of an experiment; certificates use them too.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

import numpy as np

from .statistics.core import Rows, trajectory_groups, estimate_metric, interval

Statistic = Callable[[Rows], float | None]


@dataclass(frozen=True)
class Ruler:
    name: str
    measure: Callable[[Rows, int, int], dict[str, Any]]
    description: str = ""
    metric: str | None = None
    higher_is_better: bool | None = None

    def __call__(self, rows: Rows, *, bootstrap_samples: int = 2000, seed: int = 0) -> dict[str, Any]:
        result = dict(self.measure(rows, bootstrap_samples, seed))
        result.setdefault("ruler", self.name)
        return result


def rate(metric: str, *, name: str | None = None, higher_is_better: bool | None = None,
         description: str = "") -> Ruler:
    """Trajectory-weighted mean of a row metric with a top-cluster bootstrap interval.

    Metrics: correct, field_f1, schema_valid, cost, latency_ms, tokens, steps, retries,
    attempts:<harm>, occurrences:<harm>, loss:<harm>, metric:<name>.
    """
    if higher_is_better is None:
        higher_is_better = metric in {"correct", "field_f1", "schema_valid"} or None
        if metric in {"cost", "latency_ms", "tokens", "steps", "retries"} or metric.startswith(("attempts:", "occurrences:", "loss:")):
            higher_is_better = False
    return Ruler(name or metric, lambda rows, samples, seed: estimate_metric(rows, metric, samples=samples, seed=seed),
                 description or f"Mean {metric} per trajectory, 95% cluster interval", metric, higher_is_better)


def accuracy() -> Ruler:
    return rate("correct", name="accuracy", description="Fraction of trajectories with the correct final state")


def _per_trajectory(rows: Rows, statistic: Callable[[list[Mapping[str, Any]]], float], samples: int, seed: int) -> dict[str, Any]:
    groups = trajectory_groups(rows)
    values = [statistic(trials) for trials in groups.values()]
    clusters = [str(trials[0]["cluster"]) for trials in groups.values()]
    return interval(values, clusters, samples=samples, seed=seed, bounds=(0.0, 1.0))


def pass_power_k() -> Ruler:
    return Ruler("pass^k", lambda rows, s, seed: _per_trajectory(rows, lambda t: float(all(r["correct"] for r in t)), s, seed),
                 "Fraction of trajectories where every repetition is correct", None, True)


def path_consistency() -> Ruler:
    return Ruler("path_consistency",
                 lambda rows, s, seed: _per_trajectory(rows, lambda t: float(len({r.get("path_signature") for r in t}) == 1), s, seed),
                 "Fraction of trajectories whose repetitions took the identical tool-call path", None, True)


def krippendorff_alpha(units: Sequence[Sequence[Any]]) -> float | None:
    """Nominal Krippendorff's alpha over units, each a list of ratings from different raters."""
    pairable = [tuple(u) for u in units if len(u) >= 2]
    n = sum(len(u) for u in pairable)
    if n < 2:
        return None
    totals = Counter(v for u in pairable for v in u)
    observed = 0.0
    for unit in pairable:
        counts = Counter(unit)
        observed += sum(counts[c] * counts[k] for c in counts for k in counts if c != k) / (len(unit) - 1)
    observed /= n
    expected = sum(totals[c] * totals[k] for c in totals for k in totals if c != k) / (n * (n - 1))
    if expected == 0:
        return 1.0 if observed == 0 else None
    return 1.0 - observed / expected


def _cluster_bootstrap(rows: Rows, statistic: Statistic, samples: int, seed: int,
                       bounds: tuple[float, float] | None = None) -> dict[str, Any]:
    estimate = statistic(rows)
    by_cluster: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        by_cluster[str(row["cluster"])].append(row)
    names = sorted(by_cluster)
    result = {"estimate": estimate, "interval": [None, None], "confidence": 0.95,
              "clusters": len(names), "trajectories": len(trajectory_groups(rows)),
              "method": "top_cluster_bootstrap_percentile"}
    if estimate is None or len(names) < 2:
        result["method"] = "not_estimable; need the statistic and at least two clusters"
        return result
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(samples):
        chosen = rng.integers(0, len(names), len(names))
        value = statistic([r for i in chosen for r in by_cluster[names[i]]])
        if value is not None:
            draws.append(value)
    if len(draws) < samples // 2:
        result["method"] = "not_estimable; statistic undefined in most resamples"
        return result
    low, high = np.quantile(draws, [0.025, 0.975])
    if bounds:
        low, high = max(bounds[0], low), min(bounds[1], high)
    result["interval"] = [float(low), float(high)]
    return result


def inter_rater_reliability(raters: Sequence[str]) -> Ruler:
    """Krippendorff's alpha between named raters found in each trial's ratings.

    Raters may be a deterministic grader, humans, or a language-model judge run over
    the transcripts afterwards. Low agreement means the judge is not yet a ruler.
    """
    raters = tuple(raters)
    if len(raters) < 2:
        raise ValueError("Inter-rater reliability needs at least two raters")

    def statistic(rows: Rows) -> float | None:
        units = [[str(r["ratings"][name]) for name in raters if name in r.get("ratings", {})] for r in rows]
        return krippendorff_alpha(units)

    return Ruler("irr:" + "+".join(raters),
                 lambda rows, s, seed: _cluster_bootstrap(rows, statistic, s, seed, bounds=(-1.0, 1.0)),
                 f"Nominal Krippendorff's alpha between raters {', '.join(raters)}", None, True)


def agreement_with_grader(rater: str) -> Ruler:
    """Fraction of trials where a rater's verdict (truthy = correct) matches the deterministic grader."""
    def statistic(trials: list[Mapping[str, Any]]) -> float:
        judged = [(bool(r["ratings"][rater]) == bool(r["correct"])) for r in trials if rater in r.get("ratings", {})]
        return float(np.mean(judged)) if judged else float("nan")

    def measure(rows: Rows, samples: int, seed: int) -> dict[str, Any]:
        rated = [r for r in rows if rater in r.get("ratings", {})]
        if not rated:
            return {"estimate": None, "interval": [None, None], "method": "not_estimable; no ratings from this rater"}
        return _per_trajectory(rated, statistic, samples, seed)

    return Ruler(f"agreement:{rater}", measure, f"Agreement between rater {rater} and the deterministic outcome grader", None, True)


DEFAULT_RULERS: tuple[Ruler, ...] = (accuracy(), rate("field_f1"), pass_power_k(), path_consistency(),
                                    rate("cost"), rate("latency_ms"), rate("steps"))


def apply_rulers(rows: Rows, rulers: Sequence[Ruler], *, function_id: str,
                 bootstrap_samples: int = 2000, seed: int = 0) -> dict[str, dict[str, Any]]:
    selected = [r for r in rows if str(r["function_id"]) == function_id]
    if not selected:
        raise ValueError(f"No observations for function {function_id}")
    return {ruler.name: ruler(selected, bootstrap_samples=bootstrap_samples, seed=seed) for ruler in rulers}
