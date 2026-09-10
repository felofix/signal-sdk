"""Anytime-valid bounded-mean monitoring of randomly selected audit episodes."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from math import exp, log
from typing import Any

import numpy as np


def detect_drift(audit_rows: Sequence[Mapping[str, Any]], *, baselines: Mapping[str, float],
                 alpha: float = .05, expected_shift: float = .1,
                 cost_upper_bound: float | None = None) -> dict[str, Any]:
    """A bounded Hoeffding e-process, applied once per completed top cluster.

    baseline keys: attempts:<harm>, occurrences:<harm>, or cost. Every row
    must attest audit_selected=True and judged_safe=True. Selection must
    have a common nonzero inclusion probability independent of outcomes.
    """
    if not 0 < alpha < 1 or not 0 < expected_shift <= 1 or not baselines:
        raise ValueError("Specify baselines, alpha in (0,1), and normalized expected_shift in (0,1]")
    if any(not r.get("audit_selected") or not r.get("judged_safe") or not r.get("human_reviewed") for r in audit_rows):
        raise ValueError("Drift must use only randomly audited episodes that operation judged safe")
    probabilities = {float(r.get("audit_probability", 0)) for r in audit_rows}
    if probabilities and (len(probabilities) != 1 or not 0 < next(iter(probabilities)) <= 1):
        raise ValueError("Audit rows require one common, positive random inclusion probability")
    if len({r["episode_id"] for r in audit_rows}) != len(audit_rows):
        raise ValueError("Operational audit episodes may appear only once")
    clustered: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    closed = set()
    previous = None
    for row in audit_rows:
        if previous is not None and row["cluster"] != previous:
            closed.add(previous)
        if row["cluster"] in closed:
            raise ValueError("Completed audit clusters cannot be reopened")
        previous = row["cluster"]
        clustered[str(row["cluster"])].append(row)
    threshold = len(baselines) / alpha
    results = {}
    for metric, baseline in baselines.items():
        upper = float(cost_upper_bound or 0) if metric == "cost" else 1.
        if upper <= 0 or not np.isfinite(upper) or not np.isfinite(baseline) or not 0 <= baseline <= upper:
            raise ValueError("Baseline must be within finite bounds; cost requires a predeclared cost_upper_bound")
        if metric != "cost" and not metric.startswith(("attempts:", "occurrences:")):
            raise ValueError(f"Unsupported audit drift metric: {metric}")
        lam = 4 * expected_shift
        log_e = 0.
        maximum = 0.
        alarm = None
        trace = []
        for index, (cluster, observations) in enumerate(clustered.items(), 1):
            if metric == "cost":
                values = [r.get("cost") for r in observations]
                if any(v is None or not np.isfinite(v) or not 0 <= v <= upper for v in values):
                    raise ValueError("Every audited cost must be observed and within its predeclared bound")
            else:
                kind, harm = metric.split(":", 1)
                values = [float(bool(r.get("attempted" if kind == "attempts" else "occurred", {}).get(harm, False))) for r in observations]
            mean = float(np.mean(values)) / upper
            log_e += lam * (mean - baseline / upper) - lam ** 2 / 8
            maximum = max(maximum, log_e)
            if alarm is None and log_e >= log(threshold):
                alarm = index
            trace.append({"cluster": cluster, "episodes": len(observations), "observed_mean": mean * upper,
                          "log_e_value": log_e})
        results[metric] = {"baseline": baseline, "alarm": alarm is not None, "first_alarm_cluster": alarm,
                           "e_value": exp(min(log_e, 700)), "maximum_e_value": exp(min(maximum, 700)),
                           "trace": trace}
    return {"audit_episodes": len(audit_rows), "audit_clusters": len(clustered), "metrics": results,
            "familywise_alpha": alpha, "alarm_threshold": threshold,
            "method": "one-sided bounded Hoeffding e-process with Bonferroni anytime threshold",
            "assumptions": ["Audit inclusion is random and independent of outcomes among operationally safe episodes.",
                            "Each cluster is completed before it is added; future observations cannot be appended to an already monitored cluster.",
                            "Under the null each next cluster's conditional mean is at most its predeclared baseline.",
                            "The monitored population is the operationally safe book; escalated non-audit work is excluded.",
                            "Clusters are equally weighted for drift; baselines must use the same cluster-level estimand."]}
