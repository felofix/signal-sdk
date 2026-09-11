---
title: Measurement
group: Types
summary: Measurement, MeasurementConfig, ConfirmatoryComparison, ComparisonPlan, ValidityPeriod.
---

```ts
import { ComparisonPlan, ConfirmatoryComparison, Measurement, MeasurementConfig, ValidityPeriod } from "signal-sdk";

new MeasurementConfig({
  repetitions?: number;                 // 3, at least 2
  seed?: number;                        // 0
  bootstrapSamples?: number;            // 2000, at least 200
  lossSimulations?: number;             // 5000, at least 200
  currency?: string;                    // "USD"
  severityAssumptions?: Record<string, SeverityAssumption>;
  confirmatoryComparisons?: ConfirmatoryComparison[];
  prepostPlan?: ComparisonPlan | null;
  calibrationTargetResidualLoss?: number | null;
  mode?: "simulation" | "real";         // "simulation"
})

new ConfirmatoryComparison({ name, referenceId, candidateId, metric, margin, maximumSeverity?, confirmatory?, direction?, unit?, valueBounds? })
new ComparisonPlan({ declaredAt: string; comparisons: ConfirmatoryComparison[] })
new ValidityPeriod({ start: string; end: string })      // ISO-8601 with timezone, end > start
Measurement.fromJSON(snapshot: unknown): Measurement
```

## Example

```ts
const config = new MeasurementConfig({
  mode: "real", repetitions: 3, seed: 2026,
  severityAssumptions: { wrong_account: { distribution: "gamma", mean: 500, coefficientOfVariation: 1.5, currency: "USD" } },
  confirmatoryComparisons: [
    new ConfirmatoryComparison({ name: "accuracy", referenceId: a.id, candidateId: b.id, metric: "correct", margin: 0.02 }),
    new ConfirmatoryComparison({ name: "latency", referenceId: a.id, candidateId: b.id, metric: "metric:p95Latency", margin: 200, direction: "lower", unit: "ms" }),
  ],
});
const snapshot = JSON.stringify(measurement);
const restored = Measurement.fromJSON(JSON.parse(snapshot));
console.assert(restored.id === measurement.id);
```

## Measurement fields

| Name | Meaning |
|---|---|
| `schemaVersion` | `"3"`. |
| `functions` | All measured functions including controls. |
| `distribution`, `environment`, `graders` | The bound `TaskDistribution`, `EnvironmentDefinition`, `GraderDefinition`. |
| `validity` | Optional `ValidityPeriod`; the timestamp must fall inside it. |
| `controlIds` | Function IDs of the environment's controls. |
| `scenarios`, `trials` | The book and the complete crossing. |
| `timestamp` | ISO-8601 with timezone. |
| `config` | The `MeasurementConfig`. |
| `validation` | Self-validation evidence; must have `status: "PASS"`. |
| `elapsedSeconds` | Wall time of the run. |
| `id` | SHA-256 of the content. |
| `bindingId` | SHA-256 over function IDs, distribution, environment, graders and validity. |
| `with(update)`, `toJSON()` | New validated snapshot; plain object with computed ids. |

Validation enforces a complete crossed design, identical seeds per (scenario, repetition) across functions, unique IDs, and that any plan predates the measurement.

## Severity assumptions

Per consequence class: `{ distribution?: "fixed" | "gamma" | "lognormal", amount | mean: number, coefficientOfVariation?: number, currency: string }`. The currency must equal `config.currency`. Missing assumptions mean no monetary loss is estimated for that consequence class.

## ConfirmatoryComparison

`metric` is `correct`, `fieldF1`, `schemaValid`, `cost`, `latencyMs`, `tokens`, `steps`, `retries`, `loss:<consequence class>` or `metric:<name>`. Custom metrics need `direction` and `unit`. `margin` is in the metric's unit (currency per 10,000 for losses). `maximumSeverity` bounds a trial's loss so the interval is identified.
