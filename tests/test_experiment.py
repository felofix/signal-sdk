import pytest

from signal_sdk import (DEFAULT_RULERS, Trajectory, Function, FunctionImplementation, MeasurementConfig,
                        agreement_with_grader, dataset_distribution, evaluate, inter_rater_reliability,
                        measure, rate, rate_trials, run_experiment)
from signal_sdk.examples import add, arithmetic_book
from signal_sdk.rulers import krippendorff_alpha


def sloppy(context):
    result = add(context)
    return result + 1 if result is not None and result % 7 == 0 else result


def functions():
    return (FunctionImplementation(Function(name="add", implementation={"r": "1"}), add, "simulation"),
            FunctionImplementation(Function(name="sloppy", implementation={"r": "2"}), sloppy, "simulation"))


def test_labels_are_free_strings():
    distribution, trajectories = arithmetic_book(6)
    relabelled = tuple(e.model_copy(update={"label": f"tier-{i % 2}"}) for i, e in enumerate(trajectories))
    distribution = dataset_distribution("relabelled", relabelled, label_rule="alternating tiers", top_cluster="batch")
    m = measure(functions()[:1], distribution, relabelled, config=MeasurementConfig(mode="simulation", bootstrap_samples=200, loss_simulations=200))
    assert {e.label for e in m.trajectories} == {"tier-0", "tier-1"}
    with pytest.raises(ValueError):
        Trajectory(id="x", input={}, label="", ground_truth={}, cluster="c")


def test_experiment_table_and_comparisons():
    distribution, trajectories = arithmetic_book(24)
    exp = run_experiment("adders", functions(), distribution, trajectories, repetitions=2,
                         rulers=DEFAULT_RULERS + (rate("metric:missing"),))
    assert set(exp.results) == {"add", "sloppy", "never_escalate", "always_escalate"}
    assert exp.results["add"]["accuracy"]["estimate"] == 1.0
    assert exp.results["sloppy"]["accuracy"]["estimate"] < 1.0
    assert exp.results["add"]["metric:missing"]["estimate"] is None
    assert set(exp.comparisons) == {"sloppy"}
    advantage = next(c for c in exp.comparisons["sloppy"]["comparisons"] if c["name"] == "accuracy")["advantage"]
    assert advantage["estimate"] < 0 and advantage["interval"][0] < advantage["estimate"] < advantage["interval"][1]
    assert "| add |" in exp.table() and "(control)" in exp.table()
    assert exp.to_dict()["baseline"] == "add"


def test_ratings_and_inter_rater_reliability():
    distribution, trajectories = arithmetic_book(24)
    exp = run_experiment("judged", functions(), distribution, trajectories, repetitions=2)
    m = rate_trials(exp.measurement, "grader", lambda e, t: t.grades.outcome.correct)
    m = rate_trials(m, "lenient_judge", lambda e, t: t.outcome.escalated == bool(e.ground_truth.get("escalated")))
    assert m.id != exp.measurement.id
    judged = evaluate("judged", m, (inter_rater_reliability(["grader", "lenient_judge"]), agreement_with_grader("lenient_judge")), baseline="add")
    perfect = judged.results["add"]["irr:grader+lenient_judge"]
    assert perfect["estimate"] == 1.0
    disagree = judged.results["sloppy"]
    assert disagree["irr:grader+lenient_judge"]["estimate"] < 1.0
    assert disagree["agreement:lenient_judge"]["estimate"] < 1.0
    assert disagree["agreement:lenient_judge"]["interval"][0] is not None


def test_krippendorff_alpha_known_values():
    assert krippendorff_alpha([["a", "a"], ["b", "b"], ["a", "a"]]) == 1.0
    assert krippendorff_alpha([["a", "b"], ["b", "a"]]) < 0
    assert krippendorff_alpha([["a"]]) is None
    assert krippendorff_alpha([["a", "a"], ["a", "a"]]) == 1.0
