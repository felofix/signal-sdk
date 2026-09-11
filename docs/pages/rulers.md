---
title: Rulers
group: Guides
summary: How performance is measured, and how to add a measure of your own.
---

A grader judges one trial. A ruler turns the rows of many trials into one number with a 95% interval. Rulers are what an experiment reports and what a certificate is built from.

## Example

```ts
import { DEFAULT_RULERS, Ruler, accuracy, agreementWithGrader, interRaterReliability, passPowerK, pathConsistency, rate } from "@felofix/signal-sdk";
import { interval, scenarioGroups } from "@felofix/signal-sdk/statistics";

const rulers = [
  accuracy(),                          // correct final state
  rate("fieldF1"),                     // any row metric with a cluster interval
  rate("attempts:deviation"),          // attempted-deviation rate, read from emitted actions
  rate("occurrences:deviation"),       // occurred-deviation rate, read from the final state
  rate("attempts:mandate_attempt"),    // how often the barrier had to act
  rate("metric:searches", { higherIsBetter: false }),   // an environment metric
  passPowerK(),                        // all repetitions correct
  pathConsistency(),                   // identical tool-call path across repetitions
  interRaterReliability(["grader", "llm_judge"]),
  agreementWithGrader("llm_judge"),
];

// A custom ruler: fraction of scenarios answered within 3 steps on every repetition.
const fast = new Ruler("fast^k", (rows, samples, seed) => {
  const groups = [...scenarioGroups(rows).values()];
  return interval(groups.map((trials) => (trials.every((r) => r.steps <= 3) ? 1 : 0)), groups.map((t) => t[0].cluster), { samples, seed, bounds: [0, 1] });
}, { description: "All repetitions within three steps", higherIsBetter: true });
```

## Built-in rulers

| Ruler | Reads | Note |
|---|---|---|
| `accuracy()` | `correct` | Scenario-weighted; repetitions are averaged first. |
| `rate(metric)` | any row metric | `correct`, `fieldF1`, `schemaValid`, `attemptedDeviation`, `occurredDeviation`, `mandateAttempt`, `cost`, `latencyMs`, `tokens`, `steps`, `retries`, `attempts:deviation`, `attempts:<mechanism>`, `occurrences:deviation`, `occurrences:<consequence class>`, `loss:<consequence class>`, `metric:<name>`. |
| `passPowerK()` | `correct` per repetition | pass^k, not pass@k. |
| `pathConsistency()` | `pathSignature` | Same ordered tool names across repetitions. |
| `interRaterReliability(raters)` | `ratings` | Nominal Krippendorff's alpha; bootstrap over clusters. |
| `agreementWithGrader(rater)` | `ratings`, `correct` | Fraction of trials where the rater's truthy/falsy verdict matches the grader. |

`DEFAULT_RULERS` is accuracy, fieldF1, pass^k, pathConsistency, cost, latencyMs, steps.

## Intervals

Every ruler returns `{ estimate, interval: [low, high], confidence: 0.95, clusters, ... }`. Rates use the top-cluster bootstrap with a cluster-t envelope and a plain-language `zeroEventNote` when nothing was observed. A ruler that cannot be computed returns `estimate: null` and says why in `method`.

## Judges

A language-model judge is a rater. Run it over recorded transcripts with `rateTrials()`, then hold it against the deterministic grader with `agreementWithGrader()` and against other raters with `interRaterReliability()`. An alpha near 1 means the judge measures what the grader measures; below about 0.67 it is not yet a ruler. Deterministic graders still define the measured columns.

## Writing a ruler

A `Ruler` is a name plus `measure(rows, bootstrapSamples, seed) → { estimate, interval, ... }`. Rows are the objects from `observationRows()`: one per trial with `scenarioId`, `functionId`, `repetition`, `seed`, `cluster`, `label`, `threat`, `correct`, `fieldF1`, `action`, `goldAction`, `deviation`, `attemptedDeviation`, `occurredDeviation`, `mechanisms`, `primaryMechanism`, `mandateAttempt`, `consequences`, process fields, `metrics`, `ratings`, `riskSignal`. Average within a scenario first, then use `interval()` over clusters. Set `metric` if the ruler is a plain row metric so experiments can pair it.
