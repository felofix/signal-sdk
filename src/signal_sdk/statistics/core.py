"""Episode-weighted estimates and paired, top-cluster uncertainty."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from math import ceil, isfinite, log, sqrt
from typing import Any

import numpy as np
from scipy.stats import norm, t

Rows = Sequence[Mapping[str, Any]]


def validate_rows(rows: Rows, *, crossed: bool = True) -> None:
    if not rows:
        raise ValueError("At least one observation is required")
    keys: dict[str, set[tuple[str, int, int]]] = defaultdict(set)
    metadata: dict[str, tuple[str, str]] = {}
    for row in rows:
        identity = (str(row["episode_id"]), int(row["repetition"]), int(row["seed"]))
        function = str(row["function_id"])
        if identity in keys[function]:
            raise ValueError(f"Duplicate trial for {function}: {identity}")
        if any(k[:2] == identity[:2] for k in keys[function]):
            raise ValueError("One repetition cannot have multiple seeds")
        keys[function].add(identity)
        meta = (str(row["cluster"]), str(row["label"]))
        if identity[0] in metadata and metadata[identity[0]] != meta:
            raise ValueError("An episode's cluster and label must be fixed across trials")
        metadata[identity[0]] = meta
        if meta[1] not in {"easy", "complex", "impossible"}:
            raise ValueError(f"Unknown episode label: {meta[1]}")
        for value in row.get("severity", {}).values():
            if not isfinite(float(value)) or float(value) < 0:
                raise ValueError("Severity must be finite and nonnegative")
    if crossed and any(value != next(iter(keys.values())) for value in keys.values()):
        raise ValueError("Functions must use exactly the same episodes, repetitions and seeds")
    episode_repetitions: dict[str, set[int]] = defaultdict(set)
    for episode, repetition, _ in next(iter(keys.values())):
        episode_repetitions[episode].add(repetition)
    if crossed and len({tuple(sorted(v)) for v in episode_repetitions.values()}) > 1:
        raise ValueError("The crossed design requires the same repetitions on every episode")


def episode_groups(rows: Rows) -> dict[str, list[Mapping[str, Any]]]:
    result: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        result[str(row["episode_id"])].append(row)
    return dict(result)


def metric_value(row: Mapping[str, Any], metric: str) -> float | None:
    if metric == "correct":
        return float(bool(row["correct"]))
    if ":" in metric:
        kind, harm = metric.split(":", 1)
        if kind == "loss":
            return float(row.get("severity", {}).get(harm, 0)) if row.get("occurred", {}).get(harm, False) else 0.0
        field = {"attempts": "attempted", "occurrences": "occurred"}.get(kind)
        if field:
            return float(bool(row.get(field, {}).get(harm, False)))
    value = row.get(metric)
    return None if value is None else float(value)


def _bootstrap(values: np.ndarray, clusters: Sequence[str], samples: int, rng: np.random.Generator) -> np.ndarray:
    names = sorted(set(clusters))
    sums = np.array([values[np.array(clusters) == c].sum() for c in names])
    counts = np.array([sum(c == v for v in clusters) for c in names])
    result = np.empty(samples)
    for start in range(0, samples, 256):
        indices = rng.integers(0, len(names), size=(min(256, samples - start), len(names)))
        result[start:start + len(indices)] = sums[indices].sum(axis=1) / counts[indices].sum(axis=1)
    return result


def interval(values: Sequence[float], clusters: Sequence[str], *, alpha: float = 0.05,
             samples: int = 2000, seed: int = 0, bounds: tuple[float, float] | None = None) -> dict[str, Any]:
    """Resample clusters, retain all episodes, then take the episode-weighted mean.

    At boundaries, a cluster-level zero-event bound replaces a degenerate
    bootstrap. Unequal cluster sizes inflate that bound by max/mean size.
    """
    x = np.asarray(values, dtype=float)
    if not len(x) or len(x) != len(clusters) or not np.isfinite(x).all():
        raise ValueError("Finite values with one cluster per episode are required")
    if not 0 < alpha < 1 or samples < 100:
        raise ValueError("alpha must be in (0,1); use at least 100 bootstrap samples")
    names = sorted(set(clusters))
    count = len(names)
    sizes = np.array([sum(v == c for v in clusters) for c in names], dtype=float)
    estimate = float(x.mean())
    note = None
    if count < 2:
        low, high = bounds if bounds else (None, None)
        method = "insufficient_independent_clusters"
    else:
        draws = _bootstrap(x, clusters, samples, np.random.default_rng(seed))
        low, high = map(float, np.quantile(draws, [alpha / 2, 1 - alpha / 2]))
        influences = np.array([sum(x[i] - estimate for i, v in enumerate(clusters) if v == c) for c in names])
        se = sqrt(count / (count - 1) * float(np.sum(influences ** 2))) / len(x)
        width = float(t.ppf(1 - alpha / 2, count - 1)) * se
        low, high = min(low, estimate - width), max(high, estimate + width)
        method = "top_cluster_percentile_bootstrap_with_cluster_t_envelope"
        if bounds is not None and np.all(x == x[0]):
            lower, upper = bounds
            cluster_upper = min(1.0, sizes.max() / sizes.mean() * (1 - (alpha / 2) ** (1 / count)))
            if estimate == lower:
                low, high = lower, lower + (upper - lower) * cluster_upper
            elif estimate == upper:
                low, high = upper - (upper - lower) * cluster_upper, upper
            else:
                width = (upper - lower) * sqrt(float(np.sum((sizes / sizes.sum()) ** 2)) * log(2 / alpha) / 2)
                low, high = estimate - width, estimate + width
            method += "; bounded_degenerate_sample_guard"
        if bounds is not None:
            low, high = max(bounds[0], low), min(bounds[1], high)
    if bounds == (0.0, 1.0) and np.all(x == 0):
        one_sided = min(1.0, sizes.max() / sizes.mean() * (1 - alpha ** (1 / count)))
        note = (f"No events were observed in {len(x)} episodes across {count} independent clusters. "
                f"The conservative one-sided 95% upper rate bound is {one_sided:.6g}. "
                "The familiar 3/n rule assumes independent episodes; repetitions do not increase n. "
                "Here the bound uses exchangeable independent clusters and adjusts for unequal sizes.")
    return {"estimate": estimate, "interval": [low, high], "confidence": 1 - alpha,
            "episodes": len(x), "clusters": count, "method": method, "zero_event_note": note}


def estimate_metric(rows: Rows, metric: str, *, alpha: float = .05, samples: int = 2000, seed: int = 0) -> dict[str, Any]:
    values, clusters = [], []
    missing = 0
    for trials in episode_groups(rows).values():
        observations = [metric_value(row, metric) for row in trials]
        if any(value is None for value in observations):
            missing += 1
            continue
        values.append(float(np.mean(observations)))
        clusters.append(str(trials[0]["cluster"]))
    if not values:
        return {"estimate": None, "interval": [None, None], "episodes": 0, "missing_episodes": missing,
                "status": "usage_not_reported"}
    bounded = metric in {"correct", "field_f1", "schema_valid", "impossible_escalated"} or metric.startswith(("attempts:", "occurrences:"))
    result = interval(values, clusters, alpha=alpha, samples=samples, seed=seed,
                      bounds=(0.0, 1.0) if bounded else None)
    result["missing_episodes"] = missing
    return result


def summarize(rows: Rows, *, bootstrap_samples: int = 2000, seed: int = 0) -> dict[str, Any]:
    validate_rows(rows)
    result: dict[str, Any] = {}
    harms = sorted({h for row in rows for h in row.get("attempted", {})} | {h for row in rows for h in row.get("occurred", {})})
    for function_id in sorted({str(r["function_id"]) for r in rows}):
        selected = [r for r in rows if str(r["function_id"]) == function_id]
        groups = episode_groups(selected)
        labels = sorted({r["label"] for r in selected})
        events = {}
        for harm in harms:
            events[harm] = {
                "attempts": estimate_metric(selected, f"attempts:{harm}", samples=bootstrap_samples, seed=seed),
                "occurrences": estimate_metric(selected, f"occurrences:{harm}", samples=bootstrap_samples, seed=seed),
                "attempted_trials": sum(bool(r.get("attempted", {}).get(harm)) for r in selected),
                "occurred_trials": sum(bool(r.get("occurred", {}).get(harm)) for r in selected),
                "attempted_episodes": sum(any(r.get("attempted", {}).get(harm) for r in trials) for trials in groups.values()),
                "occurred_episodes": sum(any(r.get("occurred", {}).get(harm) for r in trials) for trials in groups.values()),
                "observed_loss_per_10000": _scale(estimate_metric(selected, f"loss:{harm}", samples=bootstrap_samples, seed=seed), 10000),
                "conditional_on_label": {label: {
                    "attempts": estimate_metric([r for r in selected if r["label"] == label], f"attempts:{harm}", samples=bootstrap_samples, seed=seed),
                    "occurrences": estimate_metric([r for r in selected if r["label"] == label], f"occurrences:{harm}", samples=bootstrap_samples, seed=seed),
                } for label in labels},
            }
        clusters = [str(trials[0]["cluster"]) for trials in groups.values()]
        k = len(next(iter(groups.values())))
        consistency = {
            "repetitions": k,
            "pass_power_k": interval([float(all(r["correct"] for r in trials)) for trials in groups.values()], clusters,
                                     samples=bootstrap_samples, seed=seed, bounds=(0., 1.)),
            "path_consistency": interval([float(len({r.get("path_signature") for r in trials}) == 1) for trials in groups.values()], clusters,
                                         samples=bootstrap_samples, seed=seed, bounds=(0., 1.)),
            "interpretation": "Fraction of episodes where all k repetitions pass; path consistency requires identical ordered tool-call signatures.",
        }
        process = {metric: estimate_metric(selected, metric, samples=bootstrap_samples, seed=seed)
                   for metric in ("cost", "latency_ms", "tokens", "steps", "retries", "schema_valid")}
        costs = [float(r["cost"]) for r in selected if r.get("cost") is not None]
        process["cost_distribution"] = {"observed_trials": len(costs), "missing_trials": len(selected) - len(costs),
            "median": float(np.median(costs)) if costs else None,
            "p95": float(np.quantile(costs, .95)) if costs else None,
            "p99": float(np.quantile(costs, .99)) if costs else None,
            "maximum": max(costs) if costs else None,
            "tail_mean_above_p95": float(np.mean([c for c in costs if c >= np.quantile(costs, .95)])) if costs else None}
        result[function_id] = {
            "outcome": {"correct": estimate_metric(selected, "correct", samples=bootstrap_samples, seed=seed),
                        "field_f1": estimate_metric(selected, "field_f1", samples=bootstrap_samples, seed=seed),
                        "impossible_escalated": estimate_metric([r for r in selected if r["label"] == "impossible"], "impossible_escalated", samples=bootstrap_samples, seed=seed),
                        "conditional_on_label": {label: estimate_metric([r for r in selected if r["label"] == label], "correct", samples=bootstrap_samples, seed=seed) for label in labels}},
            "events": events, "process": process, "consistency": consistency,
            "metrics": {name.removeprefix("metric:"): estimate_metric(selected, name, samples=bootstrap_samples, seed=seed)
                        for name in sorted({k for r in selected for k in r if k.startswith("metric:")})},
        }
    return {"functions": result, "unit": "episode", "resampling_unit": "top_level_cluster"}


def _scale(result: Mapping[str, Any], scale: float) -> dict[str, Any]:
    output = dict(result)
    output["estimate"] = None if result["estimate"] is None else result["estimate"] * scale
    output["interval"] = [None if v is None else v * scale for v in result["interval"]]
    return output


def compare(rows: Rows, reference_id: str, candidate_id: str, *, comparisons: Sequence[Mapping[str, Any]] = (),
            bootstrap_samples: int = 2000, seed: int = 0, family_size: int | None = None) -> dict[str, Any]:
    """Positive advantage favors the candidate; loss units are currency/10,000."""
    selected = [r for r in rows if r["function_id"] in {reference_id, candidate_id}]
    validate_rows(selected)
    if reference_id == candidate_id or {r["function_id"] for r in selected} != {reference_id, candidate_id}:
        raise ValueError("Two distinct function IDs with complete paired observations are required")
    declared = list(comparisons) or [{"name": "correct", "metric": "correct", "confirmatory": False}]
    if len({c["name"] for c in declared}) != len(declared):
        raise ValueError("Comparison names must be unique")
    family = [c for c in declared if c.get("confirmatory", False)]
    family_size = max(len(family), family_size or 0)
    reports = []
    reference = episode_groups([r for r in selected if r["function_id"] == reference_id])
    candidate = episode_groups([r for r in selected if r["function_id"] == candidate_id])
    for config in declared:
        metric = str(config["metric"])
        confirmatory = bool(config.get("confirmatory", False))
        alpha = .05 / max(1, family_size) if confirmatory else .05
        scale = 10000 if metric.startswith("loss:") else 1
        higher_is_better = metric in {"correct", "field_f1", "schema_valid"} or config.get("direction") == "higher"
        sign = 1 if higher_is_better else -1
        differences, clusters = [], []
        for episode in sorted(reference):
            left = sorted(reference[episode], key=lambda r: (r["repetition"], r["seed"]))
            right = sorted(candidate[episode], key=lambda r: (r["repetition"], r["seed"]))
            pairs = [(metric_value(a, metric), metric_value(b, metric)) for a, b in zip(left, right)]
            if any(a is None or b is None for a, b in pairs):
                raise ValueError(f"Paired metric {metric} has missing observations")
            differences.append(float(np.mean([sign * (b - a) * scale for a, b in pairs])))
            clusters.append(str(left[0]["cluster"]))
        bounds = (-1., 1.) if metric in {"correct", "field_f1", "schema_valid"} or metric.startswith(("attempts:", "occurrences:")) else None
        if config.get("value_bounds"):
            low_bound, high_bound = map(float, config["value_bounds"])
            bounds = (low_bound - high_bound, high_bound - low_bound)
        if metric.startswith("loss:") and config.get("maximum_severity") is not None:
            bound = float(config["maximum_severity"]) * scale
            if not isfinite(bound) or bound <= 0:
                raise ValueError("maximum_severity must be positive and finite")
            if any(abs(v) > bound for v in differences):
                raise ValueError("Observed loss exceeds the predeclared maximum severity")
            if any(metric_value(row, metric) * scale > bound for row in selected):
                raise ValueError("A trial loss exceeds the predeclared maximum severity")
            bounds = (-bound, bound)
        report = interval(differences, clusters, alpha=alpha, samples=bootstrap_samples, seed=seed, bounds=bounds)
        if np.ptp(differences) == 0 and bounds is None:
            report["interval"] = [None, None]
            report["method"] = "unidentified_unobserved_loss_tail; declare_maximum_severity"
        margin = config.get("margin")
        if margin is not None and (not isfinite(float(margin)) or float(margin) < 0):
            raise ValueError("A non-inferiority margin must be finite and nonnegative")
        if confirmatory and margin is None:
            raise ValueError("Confirmatory comparisons require a pre-set margin")
        low = report["interval"][0]
        conclusion = "exploratory"
        if confirmatory:
            conclusion = "non_inferior" if low is not None and low > -float(margin) else "not_established"
        reports.append({"name": config["name"], "metric": metric, "advantage": report,
                        "margin": margin, "units": config.get("unit") or ("currency_per_10000_episodes" if scale == 10000 else "rate"),
                        "confirmatory": confirmatory, "conclusion": conclusion})
    return {"reference_function_id": reference_id, "candidate_function_id": candidate_id,
            "comparison_kind": "different_functions", "paired": True,
            "confirmatory_family": [c["name"] for c in family], "family_size": family_size,
            "multiplicity": "Bonferroni simultaneous intervals; family-wise error <= 0.05 under interval coverage assumptions",
            "comparisons": reports}


def sample_size(margin_currency_per_10000: float, paired_sd_currency: float, *, power: float = .8,
                icc: float = 0, cluster_size: float = 1, comparisons: int = 1) -> dict[str, Any]:
    _power_validate(margin_currency_per_10000, paired_sd_currency, power, icc, cluster_size, comparisons)
    effect = margin_currency_per_10000 / 10000
    design_effect = 1 + (cluster_size - 1) * icc
    z = norm.ppf(1 - .05 / (2 * comparisons)) + norm.ppf(power)
    episodes = max(2, ceil((z * paired_sd_currency / effect) ** 2 * design_effect))
    clusters = max(2, ceil(episodes / cluster_size))
    return {"episodes": ceil(clusters * cluster_size), "clusters": clusters, "power": power,
            "margin_currency_per_10000": margin_currency_per_10000,
            "assumptions": {"paired_sd_currency": paired_sd_currency, "icc": icc,
                            "mean_cluster_size": cluster_size, "true_advantage": 0,
                            "design_effect": design_effect, "confirmatory_comparisons": comparisons,
                            "method": "normal approximation for paired episode differences; equal cluster sizes; plan before running"}}


def detectable_difference(episodes: int, paired_sd_currency: float, *, power: float = .8, icc: float = 0,
                          cluster_size: float = 1, comparisons: int = 1) -> dict[str, Any]:
    _power_validate(1, paired_sd_currency, power, icc, cluster_size, comparisons)
    if episodes < 2:
        raise ValueError("At least two episodes are required")
    z = norm.ppf(1 - .05 / (2 * comparisons)) + norm.ppf(power)
    difference = float(z * paired_sd_currency * sqrt((1 + (cluster_size - 1) * icc) / episodes) * 10000)
    return {"episodes": episodes, "detectable_currency_per_10000": difference, "power": power,
            "assumptions": {"paired_sd_currency": paired_sd_currency, "icc": icc,
                            "mean_cluster_size": cluster_size, "confirmatory_comparisons": comparisons,
                            "method": "normal approximation for paired episode differences"}}


def _power_validate(margin: float, sd: float, power: float, icc: float, size: float, comparisons: int) -> None:
    if not all(isfinite(float(v)) for v in (margin, sd, power, icc, size)) or margin <= 0 or sd <= 0:
        raise ValueError("Finite positive margin and paired SD are required")
    if not .5 < power < 1 or not 0 <= icc < 1 or size < 1 or comparisons < 1:
        raise ValueError("Invalid power, cluster or multiplicity assumptions")
