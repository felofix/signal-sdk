"""Two measurements with a bound predeclared currency-margin comparison."""

from datetime import UTC, datetime
import json
from pathlib import Path

from signal_sdk import ComparisonPlan, ConfirmatoryComparison, FunctionImplementation, MeasurementConfig, measure
from signal_sdk.certificate import compare_measurements
from signal_sdk.examples import demo_definition, reconcile
from signal_sdk.generators import generate_book


def slightly_different_policy(context):
    result = reconcile(context)
    return f"Completed: {result}"


distribution, episodes = generate_book(24, seed=31, vendors=8)
before = demo_definition(distribution, episodes, name="policy-before")
after = demo_definition(distribution, episodes, name="policy-after")
plan = ComparisonPlan(declared_at=datetime.now(UTC), comparisons=(
    ConfirmatoryComparison(
        name="wrong-account-loss", reference_id=before.id, candidate_id=after.id,
        metric="loss:wrong_account", margin=1000, maximum_severity=5000,
    ),
))
config = MeasurementConfig(mode="simulation", repetitions=2, seed=19,
                           prepost_plan=plan, bootstrap_samples=300, loss_simulations=300,
                           severity_assumptions={"wrong_account": {"amount": 500, "currency": "USD"}})
pre = measure((FunctionImplementation(before, reconcile, "simulation"),), distribution, episodes, config=config)
post = measure((FunctionImplementation(after, slightly_different_policy, "simulation"),), distribution, episodes, config=config)
comparison = compare_measurements(pre, post)
destination = Path("outputs/paired")
destination.mkdir(parents=True, exist_ok=True)
(destination / "pre.json").write_text(pre.model_dump_json(indent=2), encoding="utf-8")
(destination / "post.json").write_text(post.model_dump_json(indent=2), encoding="utf-8")
(destination / "comparison.json").write_text(json.dumps(comparison, indent=2), encoding="utf-8")
print(comparison["paired_differences"][0]["comparisons"][0]["conclusion"])
