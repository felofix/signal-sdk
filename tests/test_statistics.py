import pytest

from signal_sdk.statistics import (calibrate, compare, detectable_difference, interval,
                                   loss_distribution, robustness, sample_size, summarize)
from signal_sdk.statistics.drift import detect_drift
from signal_sdk.validation import _row, self_validate
from signal_sdk.runner import observation_rows


def rows():
    return [_row(e, f, r, e // 4, e % 5 != 0, e % 5 == 0) for e in range(40)
            for f in ("a", "b") for r in range(2)]


def test_zero_events_uses_clusters_and_not_repetitions():
    ci = interval([0.] * 100, [str(i // 10) for i in range(100)], samples=200, bounds=(0., 1.))
    assert ci["interval"][1] > .03
    assert "3/n" in ci["zero_event_note"]
    assert ci["episodes"] == 100 and ci["clusters"] == 10


def test_crossing_rejects_unpaired_seeds():
    data = rows()
    data[0]["seed"] = 99999
    with pytest.raises(ValueError, match="same episodes"):
        compare(data, "a", "b")


def test_ni_strict_margin_and_global_family():
    report = compare(rows(), "a", "b", comparisons=[{
        "name": "same", "metric": "loss:wrong_account", "margin": 0,
        "maximum_severity": 10, "confirmatory": True}], family_size=4, bootstrap_samples=200)
    result = report["comparisons"][0]
    assert result["conclusion"] == "not_established"
    assert result["advantage"]["confidence"] == .9875


def test_missing_severity_bound_does_not_claim_ni():
    report = compare(rows(), "a", "b", comparisons=[{
        "name": "same", "metric": "loss:wrong_account", "margin": 100,
        "confirmatory": True}], bootstrap_samples=200)
    assert report["comparisons"][0]["conclusion"] == "not_established"


def test_pass_power_k_not_at_least_one():
    data = rows()
    for row in data:
        row["correct"] = row["repetition"] == 0
    stats = summarize(data, bootstrap_samples=200)
    assert stats["functions"]["a"]["outcome"]["correct"]["estimate"] == .5
    assert stats["functions"]["a"]["consistency"]["pass_power_k"]["estimate"] == 0


def test_power_inverse_and_cluster_design_effect():
    small = sample_size(1000, 2, cluster_size=10, icc=0)
    clustered = sample_size(1000, 2, cluster_size=10, icc=.5)
    assert clustered["episodes"] > small["episodes"]
    assert detectable_difference(small["episodes"], 2)["detectable_currency_per_10000"] <= 1000


def test_calibration_cluster_holdout_and_threshold_fit():
    data = rows()
    fit = calibrate(data, function_id="a", seed=3, bootstrap_samples=200)
    test_clusters = set(fit["split"]["test_clusters"])
    assert not test_clusters & set(fit["split"]["training_clusters"])
    for row in data:
        if row["cluster"] in test_clusters:
            row["severity"]["wrong_account"] = 10000
    modified = calibrate(data, function_id="a", seed=3, bootstrap_samples=200)
    assert fit["chosen_threshold"] == modified["chosen_threshold"]


def test_loss_keeps_zero_event_uncertainty():
    data = rows()
    for row in data:
        row["occurred"] = {"wrong_account": False}
    result = loss_distribution(data, function_id="a", simulations=200,
                               severity_assumptions={"wrong_account": {"amount": 100, "currency": "USD"}})
    assert result["harms"]["wrong_account"]["p95"] > 0


def test_variants_not_in_measurement_denominator(measurement):
    primary = observation_rows(measurement)
    all_rows = observation_rows(measurement, include_variants=True)
    assert len(all_rows) == len(primary) * 3
    result = robustness(all_rows, bootstrap_samples=200)
    for function in result["functions"].values():
        assert function["original_episodes_with_variants"] == 16
        assert function["cosmetic_outcome_change_fraction"]["estimate"] == 0


def test_drift_rejects_non_audit_and_reopened_clusters():
    with pytest.raises(ValueError, match="audited"):
        detect_drift([{"episode_id": "0", "judged_safe": True}], baselines={"attempts:wrong_account": .1})
    data = [{"episode_id": str(i), "cluster": c, "audit_selected": True, "judged_safe": True,
             "audit_probability": .1, "human_reviewed": True, "attempted": {"wrong_account": True}}
            for i, c in enumerate(("a", "b", "a"))]
    with pytest.raises(ValueError, match="reopened"):
        detect_drift(data, baselines={"attempts:wrong_account": .1})


def test_drift_detects_planted_degradation():
    data = [{"episode_id": str(i), "cluster": str(i), "audit_selected": True, "judged_safe": True,
             "audit_probability": .1, "human_reviewed": True, "attempted": {"wrong_account": True}}
            for i in range(50)]
    assert detect_drift(data, baselines={"attempts:wrong_account": .1})["metrics"]["attempts:wrong_account"]["alarm"]


def test_self_validation_and_cache_integrity():
    result = self_validate()
    assert result["status"] == "PASS"
    result["status"] = "FAIL"
    assert self_validate()["status"] == "PASS"
