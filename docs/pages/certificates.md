---
title: Certificates, traces and the dashboard
group: Guides
summary: The outputs of a measurement and where to look at them.
---

A measurement yields three artefacts: certificates (one per function), an offline trace explorer, and a content-addressed snapshot that a local store and API can serve.

## Example

```ts
import { certificates, exportCertificates, markdown } from "@felofix/signal-sdk/certificate";
import { exportHtml, renderTerminal } from "@felofix/signal-sdk/visualization";
import { DashboardStore } from "@felofix/signal-sdk/dashboard";

for (const report of certificates(measurement)) {
  const outcome = report.columns.outcome as { rows: { threat: string; correct: { estimate: number } }[] };
  console.log(report.functionId.slice(0, 12), report.status, outcome.rows.map((r) => `${r.threat}=${r.correct.estimate.toFixed(2)}`).join(" "));
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

## The two columns

The measurement section of every certificate has a fixed shape.

**Column one — outcome.** Rows are threats, with labels nested. Cells: n, correct rate with interval, attempted-deviation rate with interval, occurred-deviation rate with interval; zero-count cells carry the rule-of-three upper bound in words. Two derived quantities follow: `escalatedWhenImpossible` (correct restricted to `label == impossible`) and `unnecessaryEscalation` (`wrong_action` where the function escalated and gold did not). A final population row is labelled by the threat mix and is never presented as a property of a single threat.

**Column two — mechanism.** Rows are threats. Cells: the distribution of the primary mechanism over wrong-outcome trials, with intervals, plus the `mandate_attempt` rate over all trials. The precedence that chose the primary is printed with the column.

`report.columns` carries both as data (`outcome`, `mechanism`) alongside `process` and `metrics`.

## Certificate sections, in order

1. Function identity with a hash per component
2. Task distribution with generator parameters, threat enumeration and rates, label rule, attack-suite version
3. Environment and graders
4. Validity and re-measurement triggers
5. Outcome by threat
6. Mechanism by threat
7. Custom metrics
8. Loss per 10,000 scenarios — rendered only when a severity table is supplied; reads the outcome column and the threats' consequence classes, nothing else
9. Book difficulty and rate conditional on label
10. Consistency and process
11. Calibration curve and chosen threshold
12. Robustness
13. Attack suite: which threats are injections and against which suite they were measured
14. What this measurement does not say
15. Hours and cost spent
16. Predeclared comparisons

`RiskCertificate.status` is `simulation`, `measured`, `control`, `execution_errors_present` or `invalid_provider_version`.

## Trace explorer

`traces.html` shows every trial grouped by scenario × function: goals and sub-goals, tool arguments and results, tokens, cost, latency, the outcome with its deviation, the detected and primary mechanisms, and consequence detectors. Filter by function or scenario. All untrusted content is HTML-escaped.

## Store and API

The store keeps `<id>.measurement.json` files, permits identical rewrites, rejects conflicting content, and re-verifies the hash on read. `createApp()` serves `GET /health`, `POST|GET /api/measurements`, `GET /api/measurements/{id}`, `GET /api/measurements/{id}/trials[/{index}]`, `POST|GET /api/measurements/{id}/certificate`, `GET /measurements/{id}` (HTML) and `GET /docs`. It uses Node's `http` module only and has no authentication; keep it local.
