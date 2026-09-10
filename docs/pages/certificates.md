---
title: Certificates, traces and the dashboard
group: Guides
summary: The outputs of a measurement and where to look at them.
---

A measurement yields three artefacts: certificates (one per function), an offline trace explorer, and a content-addressed snapshot that a local store and API can serve.

## Example

```ts
import { certificates, exportCertificates, markdown } from "signal-sdk/certificate";
import { exportHtml, renderTerminal } from "signal-sdk/visualization";
import { DashboardStore } from "signal-sdk/dashboard";

for (const report of certificates(measurement)) {
  console.log(report.functionId.slice(0, 12), report.status, report.columns.outcome.correct.estimate);
}

exportCertificates(measurement, "outputs/certificates");    // <function-id>.json and .md
exportHtml(measurement, "outputs/traces.html");              // offline, all data escaped
renderTerminal(measurement);                                 // plain text in the terminal

const store = new DashboardStore("outputs/store");
store.put(measurement);                                      // write-once by content id
```

```sh
node dist/src/cli.js report outputs/measurement.json --output outputs/report
node dist/src/cli.js dashboard --data outputs/store --port 8080      # http://127.0.0.1:8080/docs
```

## Certificate sections, in order

1. Function identity with a hash per component
2. Task distribution with generator parameters, hazard rates, label rule, attack-suite version
3. Environment and graders
4. Validity and re-measurement triggers
5. Harm classes: attempts, occurrences, rates with intervals
6. Custom metrics
7. Loss per 10,000 scenarios with its assumptions
8. Book difficulty and rate conditional on label
9. Consistency and process
10. Calibration curve and chosen threshold
11. Robustness
12. Injection by vector, with the sentence that it was measured against a specific suite
13. What this measurement does not say
14. Hours and cost spent
15. Predeclared comparisons

`RiskCertificate.status` is `simulation`, `measured`, `control`, `execution_errors_present` or `invalid_provider_version`.

## Trace explorer

`traces.html` shows every trial grouped by scenario × function: goals and sub-goals, tool arguments and results, tokens, cost, latency, the events table and the outcome. Filter by function or scenario. All untrusted content is HTML-escaped.

## Store and API

The store keeps `<id>.measurement.json` files, permits identical rewrites, rejects conflicting content, and re-verifies the hash on read. `createApp()` serves `GET /health`, `POST|GET /api/measurements`, `GET /api/measurements/{id}`, `GET /api/measurements/{id}/trials[/{index}]`, `POST|GET /api/measurements/{id}/certificate`, `GET /measurements/{id}` (HTML) and `GET /docs`. It uses Node's `http` module only and has no authentication; keep it local.
