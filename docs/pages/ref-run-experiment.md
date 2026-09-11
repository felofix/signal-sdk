---
title: runExperiment()
group: SDK reference
summary: Measure several functions on one book and read a set of rulers off the result.
---

```ts
import { evaluate, runExperiment } from "@felofix/signal-sdk";

runExperiment(
  name: string,
  functions: FunctionImplementation[],
  distribution: TaskDistribution,
  scenarios: Scenario[],
  options?: {
    environment?: Environment;                      // default RETURN_VALUES
    rulers?: Ruler[];                     // default DEFAULT_RULERS
    repetitions?: number;                 // 3
    seed?: number;                        // 0
    mode?: "simulation" | "real";         // "simulation"
    config?: MeasurementConfig;           // overrides repetitions/seed/mode
    validity?: ValidityPeriod | null;
    baseline?: string | null;             // function name; default the first
    onTrial?: (trial: Trial) => void;
  },
): Promise<Experiment>

evaluate(name: string, measurement: Measurement, rulers?: Ruler[], options?: { baseline?: string | null }): Experiment
```

`runExperiment()` calls `measure()` then `evaluate()`. `evaluate()` applies rulers to an existing measurement, which is how you re-read a snapshot after `rateTrials()` added ratings.

## Example

```ts
import { DEFAULT_RULERS, rate, runExperiment } from "@felofix/signal-sdk";

const experiment = await runExperiment("prompt variants", [baselineImpl, terseImpl, verboseImpl], distribution, book, {
  rulers: [...DEFAULT_RULERS, rate("tokens"), rate("attempts:external_send")],
  repetitions: 3, seed: 11, baseline: "baseline",
});
console.log(experiment.table());
console.log(experiment.comparisons.terse.comparisons[0]);
```

```json
{"name": "accuracy", "metric": "correct", "confirmatory": false, "conclusion": "exploratory",
 "advantage": {"estimate": -0.042, "interval": [-0.125, 0.041], "confidence": 0.95, "clusters": 16}}
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `name` | `string` | required | Label for the report. |
| `functions` | `FunctionImplementation[]` | required | Variants to compare. The first is the default baseline. |
| `options.rulers` | `Ruler[]` | `DEFAULT_RULERS` | What to read off the rows. |
| `options.repetitions`, `seed`, `mode` | | `3`, `0`, `"simulation"` | Used to build a `MeasurementConfig` when `config` is not given. |
| `options.baseline` | `string` | first function's name | Reference for paired comparisons. |
| others | | | As in `measure()`. |

## Returns

An `Experiment` with:

| Member | Meaning |
|---|---|
| `measurement` | The underlying immutable `Measurement`. |
| `results` | `{ [functionName]: { [rulerName]: { estimate, interval, ... } } }` for every function including controls. |
| `comparisons` | `{ [candidateName]: CompareResult }` against the baseline, one exploratory entry per ruler that has a `metric`. Controls are skipped. |
| `functions` | `{ [name]: id }`. |
| `table()` | Markdown table, functions × rulers. |
| `markdown()` | Full report with paired differences. |
| `toJSON()` | JSON-ready summary. |

## Notes

Rulers whose metric is missing on some trial (unreported `cost`, an absent `metric:<name>`) are still reported per function but not paired. Comparisons here are exploratory; declare confirmatory ones in `MeasurementConfig`.
