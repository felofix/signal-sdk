---
title: Certificates
slug: certificates-reference
group: SDK reference
summary: certificates(), markdown(), export_certificates(), compare_measurements(), limitations().
---

```python
from signal_sdk.certificate import (RiskCertificate, certificates, markdown, export_certificates,
                                    compare_measurements, limitations)

certificates(measurement: Measurement) -> tuple[RiskCertificate, ...]
markdown(certificate: RiskCertificate) -> str
export_certificates(measurement: Measurement, directory: str | Path) -> tuple[Path, ...]
compare_measurements(pre: Measurement, post: Measurement) -> dict
limitations(measurement: Measurement, function_id: str) -> list[str]
```

## Example

```python
from signal_sdk.certificate import certificates, markdown

for report in certificates(measurement):
    print(report.function_id[:12], report.status)
    print(report.columns["events"]["wrong_account"]["attempts"])
    open(f"{report.function_id}.md", "w").write(markdown(report))
```

```text
bd5aade68e88 simulation
{"estimate": 0.0, "interval": [0.0, 0.2752], "confidence": 0.95, "trajectories": 24, "clusters": 16,
 "zero_event_note": "0 attempts in 16 independent clusters; the 95% upper bound is not 0 ...", ...}
```

## RiskCertificate

| Field | Meaning |
|---|---|
| `measurement_id`, `function_id` | Content hashes. |
| `status` | `simulation`, `measured`, `control`, `execution_errors_present`, `invalid_provider_version`. |
| `columns` | `outcome`, `events`, `process`, `metrics` as returned by `summarize()`. |
| `sections` | Ordered `{"title", "data"}` blocks: identity, distribution, environment and graders, validity, harm classes, custom metrics, loss, difficulty, consistency, calibration, robustness, injection, limitations, hours and cost, comparisons. |
| `id` | Hash of the certificate. |

## compare_measurements()

Requires the same trajectories, distribution, environment, graders and repetitions, a shared `prepost_plan` that predates both, and `pre.timestamp <= post.timestamp`. Returns `pre_measurement_id`, `post_measurement_id`, the plan, `paired_differences` (one `compare()` report per planned comparison, tagged `same_function_two_measurements` or `different_functions`), and both certificate sets.

## export_certificates()

Writes `<function-id>.json` and `<function-id>.md` per function and returns the paths.

## limitations()

The generated limitations list for one function, built from the configuration: identities and period, provider-update invalidation, assumed severity, attack suite as lower bound, cluster assumptions, interval methods, mode, missing usage, missing severity assumptions.
