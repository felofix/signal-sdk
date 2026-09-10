---
title: Rulers
slug: rulers-reference
group: SDK reference
summary: Ruler, the built-in constructors and apply_rulers().
---

```python
from signal_sdk import (Ruler, rate, accuracy, pass_power_k, path_consistency,
                        inter_rater_reliability, agreement_with_grader, apply_rulers, DEFAULT_RULERS)

Ruler(name: str, measure: Callable[[Rows, int, int], dict], description: str = "",
      metric: str | None = None, higher_is_better: bool | None = None)
ruler(rows, *, bootstrap_samples=2000, seed=0) -> dict

rate(metric: str, *, name=None, higher_is_better=None, description="") -> Ruler
accuracy() -> Ruler
pass_power_k() -> Ruler
path_consistency() -> Ruler
inter_rater_reliability(raters: Sequence[str]) -> Ruler
agreement_with_grader(rater: str) -> Ruler
apply_rulers(rows, rulers, *, function_id: str, bootstrap_samples=2000, seed=0) -> dict[str, dict]
```

## Example

```python
from signal_sdk import apply_rulers, accuracy, rate, inter_rater_reliability
from signal_sdk.runner import observation_rows

rows = observation_rows(measurement)
results = apply_rulers(rows, (accuracy(), rate("attempts:wrong_account"), inter_rater_reliability(["grader", "judge"])),
                       function_id=function.id, bootstrap_samples=1000, seed=3)
print(results["accuracy"])
```

```json
{"estimate": 1.0, "interval": [0.7248, 1.0], "confidence": 0.95, "trajectories": 24, "clusters": 16,
 "method": "top_cluster_bootstrap+cluster_t_envelope; bounded_degenerate_sample_guard",
 "zero_event_note": null, "missing_trajectories": 0, "ruler": "accuracy"}
```

## Ruler

| Field | Meaning |
|---|---|
| `name` | Column header in experiment tables; key in `results`. |
| `measure(rows, bootstrap_samples, seed)` | Rows for one function → `{"estimate", "interval", ...}`. |
| `metric` | Set when the ruler is a plain row metric; enables paired comparisons in experiments. |
| `higher_is_better` | Direction for paired advantages. `None` when there is no natural direction. |

## Constructors

| Constructor | Metric | Interval |
|---|---|---|
| `rate(metric)` | `correct`, `field_f1`, `schema_valid`, `cost`, `latency_ms`, `tokens`, `steps`, `retries`, `attempts:<harm>`, `occurrences:<harm>`, `loss:<harm>`, `metric:<name>` | Top-cluster bootstrap with cluster-t envelope; bounded to [0, 1] for rates. |
| `accuracy()` | `correct` | Same. |
| `pass_power_k()` | all repetitions correct | Same, per trajectory. |
| `path_consistency()` | identical `path_signature` across repetitions | Same. |
| `inter_rater_reliability(raters)` | nominal Krippendorff's alpha over `ratings` | Percentile cluster bootstrap in [−1, 1]. |
| `agreement_with_grader(rater)` | rater verdict (truthy) == `correct` | Per trajectory, cluster interval. |

`DEFAULT_RULERS = (accuracy(), rate("field_f1"), pass_power_k(), path_consistency(), rate("cost"), rate("latency_ms"), rate("steps"))`.

## Rows

`observation_rows(measurement, include_variants=False)` produces one dictionary per trial: `trajectory_id`, `function_id`, `repetition`, `seed`, `cluster`, `label`, `correct`, `field_f1`, `required_escalation_met`, `ratings`, `schema_valid`, `steps`, `retries`, `tokens`, `cost`, `latency_ms`, `path_signature`, `attempted`, `occurred`, `severity`, `metric:<name>`, `risk_signal`, `variant_of`, `outcome_signature`, `tool_fault`, `execution_error`.

## Notes

`krippendorff_alpha(units)` in `signal_sdk.rulers` computes the statistic directly from a list of per-unit rating lists and returns `None` when it is undefined.
