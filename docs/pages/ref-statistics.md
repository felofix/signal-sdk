---
title: Statistics functions
slug: statistics-functions
group: SDK reference
summary: The estimators underneath rulers and certificates.
---

```python
from signal_sdk.statistics import (summarize, compare, difficulty, calibrate, robustness,
                                   loss_distribution, sample_size, detectable_difference, interval)
from signal_sdk.statistics.drift import detect_drift
from signal_sdk.audit import select_audit, audit_drift

interval(values, clusters, *, alpha=0.05, samples=2000, seed=0, bounds=None) -> dict
summarize(rows, *, bootstrap_samples=2000, seed=0) -> dict
compare(rows, reference_id, candidate_id, *, comparisons=(), bootstrap_samples=2000, seed=0, family_size=None) -> dict
difficulty(rows, *, seed=0, future_trajectories=10000, draws=1000) -> dict
calibrate(rows, *, function_id, target_residual_loss=None, seed=0, bins=5, bootstrap_samples=1000) -> dict
robustness(rows, *, bootstrap_samples=1000, seed=0) -> dict
loss_distribution(rows, *, function_id, severity_assumptions, simulations=5000, seed=0, horizon=10000) -> dict
sample_size(margin_currency_per_10000, paired_sd_currency, *, power=0.8, icc=0, cluster_size=1, comparisons=1) -> dict
detectable_difference(trajectories, paired_sd_currency, *, power=0.8, icc=0, cluster_size=1, comparisons=1) -> dict
detect_drift(audit_rows, *, baselines, cost_upper_bound=None, alpha=0.05, expected_shift=0.1) -> dict
```

## Example

```python
from signal_sdk.runner import observation_rows
from signal_sdk.statistics import summarize, compare, difficulty

rows = observation_rows(measurement)
summary = summarize(rows, bootstrap_samples=1000)
print(summary["functions"][function.id]["consistency"]["pass_power_k"])

report = compare(rows, reference.id, candidate.id, comparisons=[
    {"name": "acc", "metric": "correct", "margin": 0.02, "confirmatory": True},
    {"name": "leak", "metric": "loss:external_send", "margin": 500, "maximum_severity": 5000, "confirmatory": True},
])
print([c["conclusion"] for c in report["comparisons"]])

hard = difficulty(rows, seed=1)
print(hard["status"], hard["predictions"][function.id]["next_book_correct_rate"])
```

## What each returns

| Function | Result |
|---|---|
| `interval` | `estimate`, `interval`, `confidence`, `trajectories`, `clusters`, `method`, `zero_event_note`. Top-cluster bootstrap with cluster-t envelope; conservative guards for degenerate samples. |
| `summarize` | Per function: `outcome` (correct, field_f1, required_escalation_met, by label), `events` (per harm: attempts, occurrences, counts, observed loss, by label), `process` (+ cost distribution), `consistency` (pass^k, path), `metrics`. |
| `compare` | Paired trajectory differences with Bonferroni family-wise intervals and a `non_inferior` / `not_established` / `exploratory` conclusion per comparison. |
| `difficulty` | Logistic mixed model `correct ~ function × label + (1|cluster) + (1|trajectory) + (1|trajectory:function)`; leave-function-out difficulty per trajectory, label-explained variance, posterior predictions for the next 10,000 trajectories with a width check. Needs 12 trajectories, 2 functions, 4 clusters. |
| `calibrate` | Risk signal versus attempted events; threshold fitted on half the clusters, curves reported on the other half. |
| `robustness` | Cosmetic outcome-change fraction over variants; tool-fault mishandled fraction. |
| `loss_distribution` | Per harm: simulated loss per 10,000 trajectories from occurrence frequency (Jeffreys beta) and an assumed fixed / gamma / lognormal severity; mean, percentiles, tail mean, intervals. |
| `sample_size`, `detectable_difference` | Paired normal approximation with cluster design effect. |
| `detect_drift` | Hoeffding e-process per metric over completed audit clusters, Bonferroni anytime threshold. Audit rows only. |

See [Statistics guide](#/statistics) for estimands and assumptions.
