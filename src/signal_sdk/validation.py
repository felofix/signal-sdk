"""Repeatable simulation checks that must pass before measurement execution."""

from __future__ import annotations

from functools import lru_cache
from time import perf_counter

import numpy as np
from scipy.special import expit
from scipy.stats import binomtest, spearmanr

from .models import content_hash, freeze, thaw
from .statistics import calibrate, compare, difficulty, interval, loss_distribution


def _row(trajectory: int, function: str, repetition: int, cluster: int,
         correct: bool, harm: bool, *, label: str = "easy", cost: float = .01) -> dict:
    return {"trajectory_id": str(trajectory), "function_id": function, "repetition": repetition,
            "seed": trajectory * 10 + repetition, "cluster": str(cluster), "label": label,
            "correct": correct, "path_signature": "pay" if correct else "escalate",
            "cost": cost, "latency_ms": 5., "tokens": 10, "steps": 2, "retries": 0,
            "schema_valid": True, "attempted": {"wrong_account": harm},
            "occurred": {"wrong_account": harm}, "severity": {"wrong_account": 10. if harm else 0.},
            "risk_signal": .8 if harm else .1}


def _check(name: str, passed: bool, **evidence: object) -> dict:
    return {"name": name, "status": "PASS" if passed else "FAIL", **evidence}


def statistical_checks(seed: int = 1729) -> list[dict]:
    rng = np.random.default_rng(seed)
    checks = []
    covered = 0
    simulations = 150
    for simulation in range(simulations):
        cluster_probability = rng.beta(.2 * 5, .8 * 5, 40)
        trajectories = rng.binomial(1, np.repeat(cluster_probability, 4)).astype(float)
        estimate = interval(trajectories, [str(i // 4) for i in range(160)],
                            samples=300, seed=seed + simulation, bounds=(0., 1.))
        covered += estimate["interval"][0] <= .2 <= estimate["interval"][1]
    monte_carlo = binomtest(covered, simulations).proportion_ci(.95)
    checks.append(_check("cluster_interval_coverage", covered / simulations >= .9,
                         planted_rate=.2, nominal_coverage=.95, simulated_coverage=covered / simulations,
                         monte_carlo_interval=[monte_carlo.low, monte_carlo.high],
                         simulations=simulations, acceptance_minimum=.9))
    false_passes = 0
    simulations_ni = 100
    for simulation in range(simulations_ni):
        rows = []
        for e in range(100):
            u = rng.random()
            for f, probability in (("reference", .03), ("worse", .3)):
                rows.append(_row(e, f, 0, e // 2, u >= probability, u < probability))
        report = compare(rows, "reference", "worse", bootstrap_samples=300, seed=simulation,
                         comparisons=[{"name": "wrong_account_loss", "metric": "loss:wrong_account",
                                       "margin": 1000, "maximum_severity": 10, "confirmatory": True}])
        false_passes += report["comparisons"][0]["conclusion"] == "non_inferior"
    checks.append(_check("worse_function_rejected", false_passes <= 5,
                         false_noninferiority_conclusions=false_passes, simulations=simulations_ni,
                         margin_currency_per_10000=1000, planted_excess_loss_per_10000=27000))
    zero = interval([0.] * 100, [str(i // 5) for i in range(100)], bounds=(0., 1.), samples=300)
    checks.append(_check("zero_events_not_zero_risk", zero["interval"][1] > 0 and bool(zero["zero_event_note"]),
                         upper_bound=zero["interval"][1]))
    rows = []
    planted = rng.normal(0, 1.5, 48)
    for e, value in enumerate(planted):
        label = "easy" if e % 3 == 0 else "complex" if e % 3 == 1 else "impossible"
        for f, ability in (("f0", -.5), ("f1", .5), ("f2", 1.5)):
            for repetition in range(4):
                correct = rng.random() < expit(ability - value)
                rows.append(_row(e, f, repetition, e // 3, bool(correct), not correct, label=label))
    model = difficulty(rows, seed=seed, draws=300)
    correlations = []
    for result in model.get("empirical_difficulty", {}).values():
        if result.get("status") == "estimated":
            predicted = [result["trajectories"][str(e)] for e in range(len(planted))]
            correlations.append(float(spearmanr(planted, predicted).statistic))
    checks.append(_check("difficulty_recovers_planted_order", len(correlations) == 3 and min(correlations) > .5,
                         leave_function_out_correlations=correlations, acceptance_minimum=.5,
                         fit_status=model["status"]))
    widths = [p["prediction_wider_than_measured_interval"] for p in model.get("predictions", {}).values()]
    checks.append(_check("future_prediction_wider", len(widths) == 3 and all(widths),
                         per_function_pass=widths))
    calibration = calibrate(rows, function_id="f0", seed=seed, bootstrap_samples=300)
    split = calibration.get("split", {})
    checks.append(_check("calibration_cluster_separation", calibration["status"] == "estimated"
                         and not set(split.get("training_clusters", ())) & set(split.get("test_clusters", ())),
                         split=split))
    loss_rows = [_row(e, "f0", 0, e, e % 5 != 0, e % 5 == 0) for e in range(100)]
    loss = loss_distribution(loss_rows, function_id="f0", simulations=1000, seed=seed,
                             severity_assumptions={"wrong_account": {"distribution": "fixed", "amount": 10, "currency": "USD"}})
    bounds = loss["harms"]["wrong_account"]["expected_loss_interval"]
    checks.append(_check("loss_recovers_planted_mean", bounds[0] <= 20000 <= bounds[1],
                         planted_loss_per_10000=20000, expected_loss_interval=bounds))
    return checks


def _control_check() -> dict:
    from .domains.payments import broad_mandate, generate_book, payments_domain
    from .runner import _execute, control_functions

    distribution, trajectories = generate_book(40, seed=23, vendors=10,
                                           hazard_rates={"bank_detail_change": .4}, impossible_rate=.2)
    domain = payments_domain(broad_mandate(trajectories))
    results = {control.definition.name: [_execute(control, trajectory, 0, 0, domain) for trajectory in trajectories]
               for control in control_functions(domain)}
    def harm(name: str, key: str) -> int:
        return sum(event.attempted for trial in results[name] for event in trial.grades.events if event.harm == key)
    pay_wrong, escalate_wrong = harm("always_pay", "wrong_account"), harm("always_escalate", "wrong_account")
    pay_unnecessary, escalate_unnecessary = harm("always_pay", "unnecessary_escalation"), harm("always_escalate", "unnecessary_escalation")
    easy = [i for i, trajectory in enumerate(trajectories) if trajectory.ground_truth.get("payments")]
    separates = (pay_wrong > escalate_wrong and escalate_unnecessary > pay_unnecessary
                 and any(results["always_pay"][i].grades.outcome.correct
                         and not results["always_escalate"][i].grades.outcome.correct for i in easy))
    return _check("controls_separated", separates, always_pay_wrong_account_attempts=pay_wrong,
                  always_escalate_wrong_account_attempts=escalate_wrong,
                  always_escalate_unnecessary_escalations=escalate_unnecessary)


@lru_cache(maxsize=4)
def _cached_validation(seed: int) -> dict:
    start = perf_counter()
    checks = statistical_checks(seed)
    checks.append(_control_check())
    result = {"status": "PASS" if all(c["status"] == "PASS" for c in checks) else "FAIL",
              "suite_version": "signal-self-validation-v1", "seed": seed, "checks": checks,
              "elapsed_seconds": perf_counter() - start,
              "scope": "Finite seeded simulations check selected statistical regimes; passing is not universal statistical validation."}
    result["evidence_id"] = content_hash(result)
    return freeze(result)


def self_validate(seed: int = 1729) -> dict:
    """Return a fresh copy of cached evidence; callers cannot mutate the gate."""
    return thaw(_cached_validation(seed))
