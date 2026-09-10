---
title: Comparisons and power
group: Guides
summary: Predeclared non-inferiority, pre/post, and planning the book size.
---

Exploratory comparisons come free with every experiment. A comparison that decides something is declared before the run, with a margin, and reported with a family-wise interval.

## Example

```python
from datetime import UTC, datetime
from signal_sdk import ComparisonPlan, ConfirmatoryComparison, MeasurementConfig, measure
from signal_sdk.certificate import compare_measurements
from signal_sdk.statistics import sample_size, detectable_difference

# Plan the book before running.
print(sample_size(margin_currency_per_10000=1000, paired_sd_currency=2, cluster_size=10, icc=0.2, comparisons=2))
print(detectable_difference(trajectories=400, paired_sd_currency=2, cluster_size=10, icc=0.2))

# Within one measurement: two functions, one declared family.
config = MeasurementConfig(mode="real", repetitions=3, confirmatory_comparisons=(
    ConfirmatoryComparison(name="accuracy-not-worse", reference_id=before.id, candidate_id=after.id,
                           metric="correct", margin=0.02),
    ConfirmatoryComparison(name="leak-loss", reference_id=before.id, candidate_id=after.id,
                           metric="loss:external_send", margin=500, maximum_severity=5000),
))

# Pre/post on the same book: bind one plan to both configurations.
plan = ComparisonPlan(declared_at=datetime.now(UTC), comparisons=(
    ConfirmatoryComparison(name="wrong-account", reference_id=before.id, candidate_id=after.id,
                           metric="loss:wrong_account", margin=1000, maximum_severity=5000),))
pre = measure((before_impl,), distribution, book, domain=domain, config=MeasurementConfig(prepost_plan=plan, mode="simulation"))
post = measure((after_impl,), distribution, book, domain=domain, config=MeasurementConfig(prepost_plan=plan, mode="simulation"))
report = compare_measurements(pre, post)
print(report["paired_differences"][0]["comparisons"][0]["conclusion"])   # non_inferior | not_established
```

## Metrics you can compare

`correct`, `field_f1`, `schema_valid`, `cost`, `latency_ms`, `tokens`, `steps`, `retries`, `loss:<harm>` (currency per 10,000 trajectories), `metric:<name>` (needs `direction` and `unit`, optionally `value_bounds`). Positive advantage always favours the candidate.

## Non-inferiority

Concluded only when the lower interval bound is strictly above `-margin`. For monetary losses the interval is unidentified unless `maximum_severity` bounds the per-trial loss; without it the conclusion is `not_established`, never non-inferior. Failing to establish non-inferiority is not a finding of inferiority.

## Multiplicity

All confirmatory comparisons in a measurement (or a bound pre/post plan) form one family with Bonferroni-adjusted intervals. Declare either `confirmatory_comparisons` or a `prepost_plan`, not both. Everything else is marked exploratory.

## Pre/post

`compare_measurements(pre, post)` requires identical trajectories, distribution, environment, graders, repetitions and plan, and the plan must predate both. It says whether it compared two functions or two measurements of one function identity.

## Power

`sample_size()` and `detectable_difference()` use a paired normal approximation with the cluster design effect `1 + (cluster_size − 1)·ICC`. Bring a paired standard deviation and an ICC from a pilot; the functions do not infer power after the fact.
