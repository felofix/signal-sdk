"""Explicit frequency/severity assumptions and compound loss simulation."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from .core import Rows, trajectory_groups, estimate_metric, validate_rows


def loss_distribution(rows: Rows, *, function_id: str, severity_assumptions: Mapping[str, Mapping[str, Any]],
                      simulations: int = 5000, seed: int = 0, horizon: int = 10000) -> dict[str, Any]:
    selected = [r for r in rows if r["function_id"] == function_id]
    validate_rows(selected)
    if simulations < 100 or horizon < 1:
        raise ValueError("Use at least 100 simulations and a positive horizon")
    rng = np.random.default_rng(seed)
    groups = trajectory_groups(selected)
    cluster_sizes: dict[str, int] = {}
    for trials in groups.values():
        cluster = str(trials[0]["cluster"])
        cluster_sizes[cluster] = cluster_sizes.get(cluster, 0) + 1
    weights = np.array(list(cluster_sizes.values()), dtype=float)
    effective_clusters = float(weights.sum() ** 2 / np.sum(weights ** 2))
    harms = sorted({h for r in selected for h in r.get("occurred", {})} | set(severity_assumptions))
    output = {}
    for harm in harms:
        if harm not in severity_assumptions:
            output[harm] = {"status": "severity_assumption_required"}
            continue
        assumptions = dict(severity_assumptions[harm])
        kind = assumptions.get("distribution", "fixed")
        mean = float(assumptions.get("mean", assumptions.get("amount", 0)))
        if not np.isfinite(mean) or mean < 0:
            raise ValueError("Assumed severity mean must be finite and nonnegative")
        if not assumptions.get("currency"):
            raise ValueError("Every severity assumption must state its currency")
        if kind not in {"fixed", "gamma", "lognormal"}:
            raise ValueError("Severity distribution must be fixed, gamma or lognormal")
        cv = float(assumptions.get("coefficient_of_variation", 1))
        if not np.isfinite(cv) or cv <= 0:
            raise ValueError("coefficient_of_variation must be positive and finite")
        trajectory_rates = [np.mean([bool(r.get("occurred", {}).get(harm, False)) for r in trials]) for trials in groups.values()]
        frequency = float(np.mean(trajectory_rates))
        # Clusters, not repeated trials, determine frequency information.
        # Fractional pseudo-counts form an explicitly assumed conservative
        # beta model; these are posterior predictions, not bootstrap CIs.
        a, b = .5 + frequency * effective_clusters, .5 + (1 - frequency) * effective_clusters
        frequencies = rng.beta(a, b, simulations)
        counts = rng.binomial(horizon, frequencies)
        totals = counts.astype(float) * mean
        if mean > 0 and kind == "gamma":
            shape = 1 / cv ** 2
            active = counts > 0
            totals[active] = rng.gamma(counts[active] * shape, mean / shape)
        elif mean > 0 and kind == "lognormal":
            sigma = np.sqrt(np.log1p(cv ** 2))
            mu = np.log(mean) - sigma ** 2 / 2
            for index, count in enumerate(counts):
                totals[index] = float(rng.lognormal(mu, sigma, int(count)).sum())
        expected = frequencies * horizon * mean
        output[harm] = {"status": "simulated", "currency": assumptions["currency"],
                        "occurrence_frequency": estimate_metric(selected, f"occurrences:{harm}", seed=seed),
                        "severity_assumption": {**assumptions, "distribution": kind, "mean": mean},
                        "mean": float(np.mean(totals)), "median": float(np.median(totals)),
                        "p95": float(np.quantile(totals, .95)), "p99": float(np.quantile(totals, .99)),
                        "tail_mean_above_p99": float(np.mean(totals[totals >= np.quantile(totals, .99)])),
                        "expected_loss_interval": list(map(float, np.quantile(expected, [.025, .975]))),
                        "predictive_interval": list(map(float, np.quantile(totals, [.025, .975]))),
                        "frequency_model": {"family": "beta", "prior_alpha": .5, "prior_beta": .5,
                                            "posterior_alpha": a, "posterior_beta": b,
                                            "effective_independent_clusters": effective_clusters},
                        "interval_kind": "95% assumption-dependent posterior credible/predictive intervals"}
    return {"function_id": function_id, "horizon_trajectories": horizon, "simulations": simulations, "seed": seed,
            "harms": output,
            "assumptions": ["Severity distributions are assumptions, not inferred guarantees.",
                            "Frequency uses an assumed beta model with effective top-level cluster counts and Jeffreys prior.",
                            "Future occurrence counts are conditionally binomial; clustered bursts beyond parameter uncertainty are not modeled.",
                            "Severity is independent of frequency and trajectories within each harm class.",
                            "Harm classes are reported separately because the same occurrence may satisfy multiple graders.",
                            "Zero observed events retain nonzero frequency uncertainty."]}
