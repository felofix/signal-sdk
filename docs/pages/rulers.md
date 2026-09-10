---
title: Rulers
group: Guides
summary: How performance is measured, and how to add a measure of your own.
---

A grader judges one trial. A ruler turns the rows of many trials into one number with a 95% interval. Rulers are what an experiment reports and what a certificate is built from.

## Example

```python
from signal_sdk import (Ruler, rate, accuracy, pass_power_k, path_consistency,
                        inter_rater_reliability, agreement_with_grader, DEFAULT_RULERS)
from signal_sdk.statistics import interval
from signal_sdk.statistics.core import trajectory_groups

rulers = (
    accuracy(),                        # correct final state
    rate("field_f1"),                  # any row metric with a cluster interval
    rate("attempts:external_send"),    # harm attempt rate
    rate("loss:external_send"),        # occurred severity, per trajectory
    rate("metric:searches", higher_is_better=False),   # a domain metric
    pass_power_k(),                    # all repetitions correct
    path_consistency(),                # identical tool-call path across repetitions
    inter_rater_reliability(["grader", "llm_judge"]),
    agreement_with_grader("llm_judge"),
)

# A custom ruler: fraction of trajectories answered within 3 steps on every repetition.
def fast(rows, samples, seed):
    groups = trajectory_groups(rows)
    values = [float(all(r["steps"] <= 3 for r in trials)) for trials in groups.values()]
    clusters = [str(trials[0]["cluster"]) for trials in groups.values()]
    return interval(values, clusters, samples=samples, seed=seed, bounds=(0.0, 1.0))

rulers += (Ruler("fast^k", fast, "All repetitions within three steps", higher_is_better=True),)
```

## Built-in rulers

| Ruler | Reads | Note |
|---|---|---|
| `accuracy()` | `correct` | Trajectory-weighted; repetitions are averaged first. |
| `rate(metric)` | any row metric | `correct`, `field_f1`, `schema_valid`, `cost`, `latency_ms`, `tokens`, `steps`, `retries`, `attempts:<harm>`, `occurrences:<harm>`, `loss:<harm>`, `metric:<name>`. |
| `pass_power_k()` | `correct` per repetition | pass^k, not pass@k. |
| `path_consistency()` | `path_signature` | Same ordered tool names across repetitions. |
| `inter_rater_reliability(raters)` | `ratings` | Nominal Krippendorff's alpha; bootstrap over clusters. |
| `agreement_with_grader(rater)` | `ratings`, `correct` | Fraction of trials where the rater's truthy/falsy verdict matches the grader. |

`DEFAULT_RULERS` is accuracy, field_f1, pass^k, path_consistency, cost, latency_ms, steps.

## Intervals

Every ruler returns `{"estimate", "interval": [low, high], "confidence": 0.95, "clusters", ...}`. Rates use the top-cluster bootstrap with a cluster-t envelope and a plain-language `zero_event_note` when nothing was observed. A ruler that cannot be computed returns `estimate: None` and says why in `method`.

## Judges

A language-model judge is a rater. Run it over recorded transcripts with `rate_trials()`, then hold it against the deterministic grader with `agreement_with_grader()` and against other raters with `inter_rater_reliability()`. An alpha near 1 means the judge measures what the grader measures; below about 0.67 it is not yet a ruler. Deterministic graders still define insured harms.

## Writing a ruler

A `Ruler` is a name plus `measure(rows, bootstrap_samples, seed) -> dict`. Rows are the dictionaries from `observation_rows()`: one per trial with `trajectory_id`, `function_id`, `repetition`, `seed`, `cluster`, `label`, `correct`, `field_f1`, process fields, `attempted`, `occurred`, `severity`, `metric:*`, `ratings`, `risk_signal`. Average within a trajectory first, then use `interval()` over clusters. Set `metric` if the ruler is a plain row metric so experiments can pair it.
