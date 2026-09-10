from datetime import UTC, datetime, timedelta

import pytest

from signal_sdk.certificate import compare_measurements, limitations
from signal_sdk.domain import RETURN_VALUES
from signal_sdk.domains.payments import generate_book, payments_domain
from signal_sdk.examples import add, arithmetic_book, arithmetic_demo, demo_definition, demo_mandate, reconcile
from signal_sdk.models import ComparisonPlan, ConfirmatoryComparison, Function, MeasurementConfig, ValidityPeriod
from signal_sdk.runner import FunctionImplementation, _execute, measure


def payments(count=2, **kwargs):
    distribution, episodes = generate_book(count, **kwargs)
    return distribution, episodes, payments_domain(demo_mandate(episodes))


def test_gate_stops_execution(monkeypatch):
    distribution, episodes, domain = payments()
    monkeypatch.setattr("signal_sdk.validation.self_validate", lambda: {"status": "FAIL"})
    called = []
    with pytest.raises(RuntimeError, match="Self-validation failed"):
        measure((FunctionImplementation(demo_definition(), lambda ctx: called.append(ctx), "simulation"),),
                distribution, episodes, domain=domain, config=MeasurementConfig(mode="simulation"))
    assert not called


def test_modified_generator_book_rejected():
    distribution, episodes, domain = payments()
    changed = episodes[0].model_copy(update={"ground_truth": {"payments": []}})
    with pytest.raises(ValueError, match="reproduce"):
        measure((FunctionImplementation(demo_definition(), reconcile, "simulation"),), distribution,
                (changed, *episodes[1:]), domain=domain)


def test_generated_book_needs_a_reproducing_domain():
    distribution, episodes, _ = payments()
    with pytest.raises(ValueError, match="dataset_distribution"):
        measure((FunctionImplementation(demo_definition(), reconcile, "simulation"),), distribution, episodes,
                domain=RETURN_VALUES, config=MeasurementConfig(mode="simulation"))


def test_real_cannot_use_simulation_mode():
    distribution, episodes, domain = payments()
    with pytest.raises(ValueError, match="Real functions"):
        measure((FunctionImplementation(demo_definition(), reconcile),), distribution, episodes,
                domain=domain, config=MeasurementConfig(mode="simulation"))


def test_real_observed_model_version_mismatch(clean_episode):
    def execute(ctx):
        ctx.tools.record_usage(tokens=10, cost=.1, metadata={"provider_version": "different"})
        ctx.tools.escalate()
    result = _execute(FunctionImplementation(demo_definition(), execute), clean_episode, 0, 0)
    assert "provider version" in result.error


def test_unreported_real_usage_is_not_zero(clean_episode):
    result = _execute(FunctionImplementation(demo_definition(), lambda ctx: ctx.tools.escalate()), clean_episode, 0, 0)
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
    def execute(ctx):
        ctx.tools.escalate()
        raise RuntimeError("after action")
    result = _execute(FunctionImplementation(demo_definition(), execute, "simulation"), clean_episode, 0, 0)
    assert result.outcome.escalated and result.error


def test_controls_and_paired_seeds(measurement):
    assert {f.name for f in measurement.functions} >= {"always_pay", "always_escalate"}
    assert len(measurement.control_ids) == 2
    for episode in measurement.episodes:
        for repetition in range(2):
            assert len({t.seed for t in measurement.trials if t.episode_id == episode.id and t.repetition == repetition}) == 1


def test_default_domain_grades_return_values():
    m = arithmetic_demo(12, repetitions=2)
    by_name = {f.name: f.id for f in m.functions}
    correct = {name: [t.grades.outcome.correct for t in m.trials if t.function_id == fid] for name, fid in by_name.items()}
    assert all(correct["add"])
    assert any(correct["never_escalate"]) is False or sum(correct["never_escalate"]) < len(correct["never_escalate"])
    assert 0 < sum(correct["always_escalate"]) < len(correct["always_escalate"])
    assert m.environment.name == "return-values" and m.graders.name == "return-value"


def test_validity_binds_to_measurement():
    distribution, episodes = arithmetic_book(6)
    function = Function(name="add", implementation={"revision": "1"})
    now = datetime.now(UTC)
    with pytest.raises(ValueError, match="validity period"):
        measure((FunctionImplementation(function, add, "simulation"),), distribution, episodes,
                config=MeasurementConfig(mode="simulation"),
                validity=ValidityPeriod(start=now + timedelta(days=1), end=now + timedelta(days=2)))
    m = measure((FunctionImplementation(function, add, "simulation"),), distribution, episodes,
                config=MeasurementConfig(mode="simulation", bootstrap_samples=200, loss_simulations=200),
                validity=ValidityPeriod(start=now - timedelta(days=1), end=now + timedelta(days=2)))
    assert m.validity is not None and "during" in " ".join(limitations(m, function.id))


def test_config_limitations(measurement):
    text = " ".join(limitations(measurement, measurement.functions[0].id))
    assert "Severity is assumed" in text
    assert "lower bound" in text
    assert "model update at the provider invalidates" in text
    assert measurement.distribution.id in text and measurement.environment.id in text


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
    with pytest.raises(ValueError, match="same environment"):
        compare_measurements(pre, post.model_copy(update={"environment": post.environment.model_copy(update={"name": "other"})}))
