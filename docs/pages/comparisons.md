---
title: Comparisons and power
group: Guides
summary: Predeclared non-inferiority, pre/post, and planning the book size.
---

Exploratory comparisons come free with every experiment. A comparison that decides something is declared before the run, with a margin, and reported with a family-wise interval.

## Example

```ts
import { ComparisonPlan, ConfirmatoryComparison, MeasurementConfig, measure } from "@felofix/signal-sdk";
import { compareMeasurements } from "@felofix/signal-sdk/certificate";
import { detectableDifference, sampleSize } from "@felofix/signal-sdk/statistics";

// Plan the book before running.
console.log(sampleSize(1000, 2, { clusterSize: 10, icc: 0.2, comparisons: 2 }));
console.log(detectableDifference(400, 2, { clusterSize: 10, icc: 0.2 }));

// Within one measurement: two functions, one declared family.
const config = new MeasurementConfig({ mode: "real", repetitions: 3, confirmatoryComparisons: [
  new ConfirmatoryComparison({ name: "accuracy-not-worse", referenceId: before.id, candidateId: after.id, metric: "correct", margin: 0.02 }),
  new ConfirmatoryComparison({ name: "leak-loss", referenceId: before.id, candidateId: after.id, metric: "loss:external_send", margin: 500, maximumSeverity: 5000 }),
] });

// Pre/post on the same book: bind one plan to both configurations.
const plan = new ComparisonPlan({ declaredAt: new Date().toISOString(), comparisons: [
  new ConfirmatoryComparison({ name: "wrong-account", referenceId: before.id, candidateId: after.id, metric: "loss:wrong_account", margin: 1000, maximumSeverity: 5000 }),
] });
const pre = await measure([beforeImpl], distribution, book, { environment, config: new MeasurementConfig({ prepostPlan: plan, mode: "simulation" }) });
const post = await measure([afterImpl], distribution, book, { environment, config: new MeasurementConfig({ prepostPlan: plan, mode: "simulation" }) });
const report = compareMeasurements(pre, post);
console.log(report.pairedDifferences[0].comparisons[0].conclusion);   // non_inferior | not_established
```

## Metrics you can compare

`correct`, `fieldF1`, `schemaValid`, `cost`, `latencyMs`, `tokens`, `steps`, `retries`, `loss:<consequence class>` (currency per 10,000 scenarios), `metric:<name>` (needs `direction` and `unit`, optionally `valueBounds`). Positive advantage always favours the candidate.

## Non-inferiority

Concluded only when the lower interval bound is strictly above `-margin`. For monetary losses the interval is unidentified unless `maximumSeverity` bounds the per-trial loss; without it the conclusion is `not_established`, never non-inferior. Failing to establish non-inferiority is not a finding of inferiority.

## Multiplicity

All confirmatory comparisons in a measurement (or a bound pre/post plan) form one family with Bonferroni-adjusted intervals. Declare either `confirmatoryComparisons` or a `prepostPlan`, not both. Everything else is marked exploratory.

## Pre/post

`compareMeasurements(pre, post)` requires identical scenarios, distribution, environment, graders, repetitions and plan, and the plan must predate both. It says whether it compared two functions or two measurements of one function identity.

## Power

`sampleSize()` and `detectableDifference()` use a paired normal approximation with the cluster design effect `1 + (clusterSize − 1)·ICC`. Bring a paired standard deviation and an ICC from a pilot; the functions do not infer power after the fact.
