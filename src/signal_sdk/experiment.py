"""Experiments: several functions, one book, a set of rulers, a table.

The same machinery as a certificate, without the insurance framing. Comparisons
here are exploratory unless you predeclare them in the config.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Sequence

from .domain import RETURN_VALUES, Domain
from .models import Trajectory, Measurement, MeasurementConfig, TaskDistribution, Trial, ValidityPeriod
from .rulers import DEFAULT_RULERS, Ruler, apply_rulers
from .runner import FunctionImplementation, measure, observation_rows
from .statistics import compare
from .statistics.core import metric_value


@dataclass(frozen=True)
class Experiment:
    name: str
    measurement: Measurement
    rulers: tuple[Ruler, ...]
    results: dict[str, dict[str, dict[str, Any]]]
    comparisons: dict[str, dict[str, Any]]
    baseline: str

    @property
    def functions(self) -> dict[str, str]:
        return {f.name: f.id for f in self.measurement.functions}

    def table(self) -> str:
        """Markdown: one row per function, one column per ruler, estimate [low, high]."""
        names = [r.name for r in self.rulers]
        lines = ["| Function | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
        for function, values in self.results.items():
            cells = [_cell(values[n]) for n in names]
            tag = " (control)" if self.functions[function] in self.measurement.control_ids else ""
            lines.append(f"| {function}{tag} | " + " | ".join(cells) + " |")
        return "\n".join(lines)

    def markdown(self) -> str:
        lines = [f"# Experiment: {self.name}", "",
                 f"Measurement `{self.measurement.id}` · {len([e for e in self.measurement.trajectories if not e.variant_of])} trajectories · "
                 f"{self.measurement.config.repetitions} repetitions · baseline `{self.baseline}`", "",
                 self.table(), ""]
        if self.comparisons:
            lines += ["## Paired differences against the baseline (exploratory, positive favours the candidate)", "",
                      "| Candidate | Ruler | Advantage [95%] |", "|---|---|---|"]
            for candidate, report in self.comparisons.items():
                for item in report["comparisons"]:
                    lines.append(f"| {candidate} | {item['name']} | {_cell(item['advantage'])} |")
            lines.append("")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "measurement_id": self.measurement.id, "baseline": self.baseline,
                "rulers": [{"name": r.name, "description": r.description, "metric": r.metric} for r in self.rulers],
                "results": self.results, "comparisons": self.comparisons}


def _cell(value: dict[str, Any]) -> str:
    estimate = value.get("estimate")
    low, high = value.get("interval", [None, None])
    if estimate is None:
        return "n/a"
    if low is None or high is None:
        return f"{estimate:.3f}"
    return f"{estimate:.3f} [{low:.3f}, {high:.3f}]"


def run_experiment(name: str, functions: Sequence[FunctionImplementation], distribution: TaskDistribution,
                   trajectories: Sequence[Trajectory], *, domain: Domain = RETURN_VALUES,
                   rulers: Sequence[Ruler] = DEFAULT_RULERS, repetitions: int = 3, seed: int = 0,
                   mode: str = "simulation", config: MeasurementConfig | None = None,
                   validity: ValidityPeriod | None = None, baseline: str | None = None,
                   on_trial: Callable[[Trial], None] | None = None) -> Experiment:
    """Cross every function with the book, then read every ruler off the rows."""
    config = config or MeasurementConfig(mode=mode, repetitions=repetitions, seed=seed)
    measurement = measure(tuple(functions), distribution, tuple(trajectories), domain=domain, config=config,
                          validity=validity, on_trial=on_trial)
    return evaluate(name, measurement, rulers, baseline=baseline)


def evaluate(name: str, measurement: Measurement, rulers: Sequence[Ruler] = DEFAULT_RULERS, *,
             baseline: str | None = None) -> Experiment:
    """Apply rulers to an existing measurement; use after rate_trials() adds new ratings."""
    rows = observation_rows(measurement)
    rulers = tuple(rulers)
    config = measurement.config
    results = {f.name: apply_rulers(rows, rulers, function_id=f.id, bootstrap_samples=config.bootstrap_samples, seed=config.seed)
               for f in measurement.functions}
    baseline_name = baseline or measurement.functions[0].name
    ids = {f.name: f.id for f in measurement.functions}
    if baseline_name not in ids:
        raise ValueError(f"Unknown baseline function {baseline_name}")
    # Only metrics observed on every trial can be paired; unreported cost or an absent custom metric is skipped.
    paired = [{"name": r.name, "metric": r.metric, "confirmatory": False,
               "direction": "higher" if r.higher_is_better else "lower"} for r in rulers
              if r.metric and all(metric_value(row, r.metric) is not None for row in rows)]
    comparisons = {}
    for function in measurement.functions:
        if function.name == baseline_name or function.id in measurement.control_ids or not paired:
            continue
        comparisons[function.name] = compare(rows, ids[baseline_name], function.id, comparisons=paired,
                                             bootstrap_samples=config.bootstrap_samples, seed=config.seed)
    return Experiment(name, measurement, rulers, results, comparisons, baseline_name)


def rate_trials(measurement: Measurement, rater: str,
                judge: Callable[[Trajectory, Trial], Any]) -> Measurement:
    """Attach a rater's verdict to every trial and return a new snapshot.

    This is how a human panel or a language-model judge enters an experiment:
    after the fact, over recorded transcripts, as a rating that rulers such as
    inter_rater_reliability() can hold against the deterministic grader.
    """
    trajectories = {e.id: e for e in measurement.trajectories}
    trials = tuple(t.model_copy(update={"grades": t.grades.model_copy(update={
        "ratings": {**t.grades.ratings, rater: judge(trajectories[t.trajectory_id], t)}})}) for t in measurement.trials)
    return measurement.model_copy(update={"trials": trials})
