"""Measure any callable that returns a value: no tools, no documents, no payments.

The function under test is identified by what it is (implementation, model,
prompts, configuration). The book, the environment and the graders are bound to
the measurement, not to the function.
"""

from pathlib import Path

from signal_sdk import Trajectory, Function, FunctionImplementation, Label, MeasurementConfig, dataset_distribution, measure
from signal_sdk.certificate import export_certificates
from signal_sdk.visualization import export_html

trajectories = tuple(
    Trajectory(id=f"upper-{i:03d}", input={"task": f"Uppercase: {word}"}, label=Label.EASY,
            ground_truth={"value": word.upper()}, cluster=f"group-{i // 3}")
    for i, word in enumerate(["signal", "measure", "trajectory", "trial", "grader", "outcome", "process", "event", "loss"])
)
distribution = dataset_distribution("Uppercase words", trajectories, label_rule="all easy", top_cluster="group")


def upper(context):
    with context.tools.goal("Uppercase the word"):
        return context.input["task"].removeprefix("Uppercase: ").upper()


function = Function(name="upper", implementation={"module": __name__, "callable": "upper", "revision": "1"})
measurement = measure((FunctionImplementation(function, upper, kind="simulation"),), distribution, trajectories,
                      config=MeasurementConfig(mode="simulation", repetitions=2, bootstrap_samples=300, loss_simulations=300))
output = Path("outputs/return_values")
export_certificates(measurement, output / "certificates")
export_html(measurement, output / "traces.html")
print(output.resolve())
