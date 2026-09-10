---
title: Certificates
slug: certificates-reference
group: SDK reference
summary: certificates(), markdown(), exportCertificates(), compareMeasurements(), limitations().
---

```ts
import { RiskCertificate, certificates, compareMeasurements, exportCertificates, limitations, markdown } from "signal-sdk/certificate";

certificates(measurement: Measurement): RiskCertificate[]
markdown(certificate: RiskCertificate): string
exportCertificates(measurement: Measurement, directory: string): string[]
compareMeasurements(pre: Measurement, post: Measurement): JsonObject
limitations(measurement: Measurement, functionId: string): string[]
```

## Example

```ts
import { writeFileSync } from "node:fs";
import { certificates, markdown } from "signal-sdk/certificate";

for (const report of certificates(measurement)) {
  console.log(report.functionId.slice(0, 12), report.status);
  console.log(report.columns.events.wrong_account.attempts);
  writeFileSync(`${report.functionId}.md`, markdown(report));
}
```

```text
bd5aade68e88 simulation
{"estimate": 0, "interval": [0, 0.2752], "confidence": 0.95, "scenarios": 24, "clusters": 16,
 "zeroEventNote": "No events were observed in 24 scenarios across 16 independent clusters. The conservative one-sided 95% upper rate bound is …", ...}
```

## RiskCertificate

| Member | Meaning |
|---|---|
| `measurementId`, `functionId` | Content hashes. |
| `status` | `simulation`, `measured`, `control`, `execution_errors_present`, `invalid_provider_version`. |
| `columns` | `outcome`, `events`, `process`, `metrics` as returned by `summarize()`. |
| `sections` | Ordered `{ title, data }` blocks: identity, distribution, environment and graders, validity, harm classes, custom metrics, loss, difficulty, consistency, calibration, robustness, injection, limitations, hours and cost, comparisons. |
| `id` | Hash of the certificate. |

## compareMeasurements()

Requires the same scenarios, distribution, environment, graders and repetitions, a shared `prepostPlan` that predates both, and `pre.timestamp <= post.timestamp`. Returns `preMeasurementId`, `postMeasurementId`, the plan, `pairedDifferences` (one `compare()` report per planned comparison, tagged `same_function_two_measurements` or `different_functions`), and both certificate sets.

## exportCertificates()

Writes `<function-id>.json` and `<function-id>.md` per function and returns the paths.

## limitations()

The generated limitations list for one function, built from the configuration: identities and period, provider-update invalidation, assumed severity, attack suite as lower bound, cluster assumptions, interval methods, mode, missing usage, missing severity assumptions.
