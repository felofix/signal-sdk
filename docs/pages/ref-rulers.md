---
title: Rulers
slug: rulers-reference
group: SDK reference
summary: Ruler, the built-in constructors and applyRulers().
---

```ts
import { DEFAULT_RULERS, Ruler, accuracy, agreementWithGrader, applyRulers, interRaterReliability, krippendorffAlpha,
         passPowerK, pathConsistency, rate } from "signal-sdk";

new Ruler(name: string, measure: (rows: Row[], bootstrapSamples: number, seed: number) => RulerResult,
          options?: { description?: string; metric?: string | null; higherIsBetter?: boolean | null })
ruler.apply(rows, { bootstrapSamples?, seed? }): RulerResult

rate(metric: string, options?: { name?: string; higherIsBetter?: boolean | null; description?: string }): Ruler
accuracy(): Ruler
passPowerK(): Ruler
pathConsistency(): Ruler
interRaterReliability(raters: string[]): Ruler
agreementWithGrader(rater: string): Ruler
applyRulers(rows, rulers, { functionId, bootstrapSamples?, seed? }): Record<string, RulerResult>
krippendorffAlpha(units: string[][]): number | null
```

## Example

```ts
import { accuracy, applyRulers, interRaterReliability, observationRows, rate } from "signal-sdk";

const rows = observationRows(measurement);
const results = applyRulers(rows, [accuracy(), rate("attempts:wrong_account"), interRaterReliability(["grader", "judge"])],
  { functionId: fn.id, bootstrapSamples: 1000, seed: 3 });
console.log(results.accuracy);
```

```json
{"estimate": 1, "interval": [0.7248, 1], "confidence": 0.95, "scenarios": 24, "clusters": 16,
 "method": "top_cluster_percentile_bootstrap_with_cluster_t_envelope; bounded_degenerate_sample_guard",
 "zeroEventNote": null, "missingScenarios": 0, "ruler": "accuracy"}
```

## Ruler

| Member | Meaning |
|---|---|
| `name` | Column header in experiment tables; key in `results`. |
| `measure(rows, bootstrapSamples, seed)` | Rows for one function → `{ estimate, interval, ... }`. |
| `metric` | Set when the ruler is a plain row metric; enables paired comparisons in experiments. |
| `higherIsBetter` | Direction for paired advantages. `null` when there is no natural direction. |

## Constructors

| Constructor | Metric | Interval |
|---|---|---|
| `rate(metric)` | `correct`, `fieldF1`, `schemaValid`, `attemptedDeviation`, `occurredDeviation`, `mandateAttempt`, `cost`, `latencyMs`, `tokens`, `steps`, `retries`, `attempts:deviation`, `attempts:<mechanism>`, `occurrences:deviation`, `occurrences:<consequence class>`, `loss:<consequence class>`, `metric:<name>` | Top-cluster bootstrap with cluster-t envelope; bounded to [0, 1] for rates. |
| `accuracy()` | `correct` | Same. |
| `passPowerK()` | all repetitions correct | Same, per scenario. |
| `pathConsistency()` | identical `pathSignature` across repetitions | Same. |
| `interRaterReliability(raters)` | nominal Krippendorff's alpha over `ratings` | Percentile cluster bootstrap in [−1, 1]. |
| `agreementWithGrader(rater)` | rater verdict (truthy) === `correct` | Per scenario, cluster interval. |

`DEFAULT_RULERS = [accuracy(), rate("fieldF1"), passPowerK(), pathConsistency(), rate("cost"), rate("latencyMs"), rate("steps")]`.

## Rows

`observationRows(measurement, { includeVariants? })` produces one `Row` per trial: `scenarioId`, `functionId`, `repetition`, `seed`, `cluster`, `label`, `threat`, `correct`, `fieldF1`, `action`, `goldAction`, `deviation`, `attemptedDeviation`, `occurredDeviation`, `mechanisms`, `primaryMechanism`, `mandateAttempt`, `mechanismPrecedence`, `consequences`, `consequenceClass`, `ratings`, `schemaValid`, `steps`, `retries`, `tokens`, `cost`, `latencyMs`, `pathSignature`, `attempted`, `occurred`, `severity`, `metrics`, `riskSignal`, `variantOf`, `groundStateHash`, `outcomeSignature`, `toolFault`, `executionError`. The `attempted`/`occurred` maps carry `deviation`, each mechanism, `mandate_attempt` and each consequence class so the statistics layer reads them unchanged.
