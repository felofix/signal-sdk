---
title: run_experiment()
group: SDK reference
summary: Measure several functions on one book and read a set of rulers off the result.
---

```python
from signal_sdk import run_experiment, evaluate

run_experiment(
    name: str,
    functions: Sequence[FunctionImplementation],
    distribution: TaskDistribution,
    trajectories: Sequence[Trajectory],
    *,
    domain: Domain = RETURN_VALUES,
    rulers: Sequence[Ruler] = DEFAULT_RULERS,
    repetitions: int = 3,
    seed: int = 0,
    mode: str = "simulation",
    config: MeasurementConfig | None = None,
    validity: ValidityPeriod | None = None,
    baseline: str | None = None,
    on_trial: Callable[[Trial], None] | None = None,
) -> Experiment

evaluate(name: str, measurement: Measurement, rulers: Sequence[Ruler] = DEFAULT_RULERS, *,
         baseline: str | None = None) -> Experiment
```

`run_experiment()` calls `measure()` then `evaluate()`. `evaluate()` applies rulers to an existing measurement, which is how you re-read a snapshot after `rate_trials()` added ratings.

## Example

```python
from signal_sdk import DEFAULT_RULERS, rate, run_experiment

experiment = run_experiment(
    "prompt variants", (baseline_impl, terse_impl, verbose_impl), distribution, book,
    rulers=DEFAULT_RULERS + (rate("tokens"), rate("attempts:external_send")),
    repetitions=3, seed=11, baseline="baseline",
)
print(experiment.table())
print(experiment.comparisons["terse"]["comparisons"][0])
```

```json
{"name": "accuracy", "metric": "correct", "confirmatory": false, "conclusion": "exploratory",
 "advantage": {"estimate": -0.042, "interval": [-0.125, 0.041], "confidence": 0.95, "clusters": 16}}
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `name` | `str` | required | Label for the report. |
| `functions` | `Sequence[FunctionImplementation]` | required | Variants to compare. The first is the default baseline. |
| `rulers` | `Sequence[Ruler]` | `DEFAULT_RULERS` | What to read off the rows. |
| `repetitions`, `seed`, `mode` | | `3`, `0`, `"simulation"` | Used to build a `MeasurementConfig` when `config` is not given. |
| `baseline` | `str` | first function's name | Reference for paired comparisons. |
| others | | | As in `measure()`. |

## Returns

An `Experiment` with:

| Attribute | Meaning |
|---|---|
| `measurement` | The underlying immutable `Measurement`. |
| `results` | `{function_name: {ruler_name: {"estimate", "interval", ...}}}` for every function including controls. |
| `comparisons` | `{candidate_name: compare(...) report}` against the baseline, one exploratory entry per ruler that has a `metric`. Controls are skipped. |
| `functions` | `{name: id}`. |
| `table()` | Markdown table, functions × rulers. |
| `markdown()` | Full report with paired differences. |
| `to_dict()` | JSON-ready summary. |

## Notes

Rulers whose metric is missing on some trial (unreported `cost`, an absent `metric:<name>`) are still reported per function but not paired. Comparisons here are exploratory; declare confirmatory ones in `MeasurementConfig`.
