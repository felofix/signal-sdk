from datetime import UTC, datetime, timedelta

import pytest

from signal_sdk.certificate import compare_measurements, limitations
from signal_sdk.examples import demo_definition, reconcile
from signal_sdk.generators import generate_book
from signal_sdk.models import ComparisonPlan, ConfirmatoryComparison, MeasurementConfig
from signal_sdk.runner import FunctionImplementation, _execute, measure


def test_gate_stops_execution(monkeypatch):
    distribution, episodes = generate_book(2)
    function = demo_definition(distribution, episodes)
    monkeypatch.setattr("signal_sdk.validation.self_validate", lambda: {"status": "FAIL"})
    called = []
    with pytest.raises(RuntimeError, match="Self-validation failed"):
        measure((FunctionImplementation(function, lambda ctx: called.append(ctx), "simulation"),),
                distribution, episodes, config=MeasurementConfig(mode="simulation"))
    assert not called


def test_modified_generator_book_rejected():
    distribution, episodes = generate_book(2)
    function = demo_definition(distribution, episodes)
    changed = episodes[0].model_copy(update={"ground_truth": {"payments": []}})
    with pytest.raises(ValueError, match="reproduce"):
        measure((FunctionImplementation(function, reconcile, "simulation"),), distribution,
                (changed, *episodes[1:]))


def test_real_cannot_use_simulation_mode():
    distribution, episodes = generate_book(2)
    function = demo_definition(distribution, episodes)
    with pytest.raises(ValueError, match="Real functions"):
        measure((FunctionImplementation(function, reconcile),), distribution, episodes,
                config=MeasurementConfig(mode="simulation"))


def test_real_observed_model_version_mismatch(clean_episode):
    distribution, episodes = generate_book(1)
    function = demo_definition(distribution, episodes)
    def execute(ctx):
        ctx.tools.record_usage(tokens=10, cost=.1, metadata={"provider_version": "different"})
        ctx.tools.escalate()
    result = _execute(FunctionImplementation(function, execute), clean_episode, 0, 0)
    assert "provider version" in result.error


def test_unreported_real_usage_is_not_zero(clean_episode):
    distribution, episodes = generate_book(1)
    function = demo_definition(distribution, episodes)
    result = _execute(FunctionImplementation(function, lambda ctx: ctx.tools.escalate()), clean_episode, 0, 0)
    assert result.error
    assert result.grades.process.tokens is None
    assert result.grades.process.cost is None


def test_comparison_family_cannot_be_split(measurement):
    fid = measurement.functions[0].id
    comparison = ConfirmatoryComparison(name="test", reference_id=fid, candidate_id=fid, metric="correct", margin=.1)
    plan = ComparisonPlan(declared_at=measurement.timestamp, comparisons=(comparison,))
    with pytest.raises(ValueError, match="entire confirmatory family"):
        MeasurementConfig(prepost_plan=plan, confirmatory_comparisons=(comparison,))


def test_exception_retains_completed_actions(clean_episode):
    distribution, episodes = generate_book(1)
    function = demo_definition(distribution, episodes)
    def execute(ctx):
        ctx.tools.escalate()
        raise RuntimeError("after action")
    result = _execute(FunctionImplementation(function, execute, "simulation"), clean_episode, 0, 0)
    assert result.outcome.escalated and result.error


def test_controls_and_paired_seeds(measurement):
    assert {f.name for f in measurement.functions} >= {"always_pay", "always_escalate"}
    for episode in measurement.episodes:
        for repetition in range(2):
            assert len({t.seed for t in measurement.trials if t.episode_id == episode.id and t.repetition == repetition}) == 1


def test_config_limitations_and_period(measurement):
    text = " ".join(limitations(measurement, measurement.functions[0].id))
    assert "Severity is assumed" in text
    assert "lower bound" in text
    assert "model update at the provider invalidates" in text
    assert measurement.distribution.id in text


def test_prepost_must_be_same_book_and_registered(measurement):
    with pytest.raises(ValueError, match="predeclared"):
        compare_measurements(measurement, measurement)


def test_prepost_paired_report(measurement, monkeypatch):
    from signal_sdk import certificate
    fid = measurement.functions[0].id
    declaration = ComparisonPlan(declared_at=measurement.timestamp - timedelta(seconds=1), comparisons=(
        ConfirmatoryComparison(name="same_book", reference_id=fid, candidate_id=fid,
                               metric="correct", margin=.1),))
    config = measurement.config.model_copy(update={"prepost_plan": declaration})
    pre = measurement.model_copy(update={"config": config})
    post = pre.model_copy(update={"timestamp": datetime.now(UTC)})
    monkeypatch.setattr(certificate, "certificates", lambda m: ())
    result = compare_measurements(pre, post)
    assert result["paired_differences"][0]["comparison_kind"] == "same_function_two_measurements"
    changed = post.trials[0].model_copy(update={"seed": 123})
    with pytest.raises(ValueError, match="same seeds"):
        post.model_copy(update={"trials": (changed, *post.trials[1:])})
