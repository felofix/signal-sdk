---
title: Run an experiment
group: Get started
summary: Compare variants on one book, pick your rulers, attach a judge.
---

An experiment is several functions on the same book, read with the same rulers. Every function sees the same scenarios with the same seeds, so differences are paired. Comparisons are exploratory unless you predeclare them.

## Example

```ts
import { DEFAULT_RULERS, Function, FunctionImplementation, agreementWithGrader, evaluate,
         interRaterReliability, rate, rateTrials, runExperiment } from "@felofix/signal-sdk";
import { add, arithmeticBook } from "@felofix/signal-sdk/examples";

const { distribution, scenarios } = arithmeticBook(24, 0);

const sloppy: typeof add = (context) => { const r = add(context); return r !== null && r % 7 === 0 ? r + 1 : r; };

const variants = [
  new FunctionImplementation(new Function({ name: "add", implementation: { revision: "1" } }), add, "simulation"),
  new FunctionImplementation(new Function({ name: "sloppy", implementation: { revision: "2" } }), sloppy, "simulation"),
];
const experiment = await runExperiment("adders", variants, distribution, scenarios,
  { repetitions: 2, rulers: [...DEFAULT_RULERS, rate("tokens")], baseline: "add" });
console.log(experiment.table());

// Attach raters after the fact and measure whether they agree.
let judged = await rateTrials(experiment.measurement, "grader", (_s, trial) => trial.grades.outcome.correct);
judged = await rateTrials(judged, "llm_judge", myLlmJudge);      // your (scenario, trial) => verdict, may be async
const reliability = evaluate("judged adders", judged,
  [interRaterReliability(["grader", "llm_judge"]), agreementWithGrader("llm_judge")], { baseline: "add" });
console.log(reliability.table());
```

```text
| Function                  | accuracy             | fieldF1              | pass^k               | path_consistency     | cost | latencyMs            | steps                | tokens               |
|---|---|---|---|---|---|---|---|---|
| add                       | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | n/a  | 0.000 [0.000, 0.001] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.000] |
| sloppy                    | 0.875 [0.696, 1.000] | 0.875 [0.696, 1.000] | 0.875 [0.696, 1.000] | 1.000 [0.541, 1.000] | n/a  | 0.000 [0.000, 0.001] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.000] |
| never_escalate (control)  | 0.000 [0.000, 0.459] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.459] | 1.000 [0.541, 1.000] | n/a  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| always_escalate (control) | 0.167 [0.031, 0.302] | 0.167 [0.031, 0.302] | 0.167 [0.031, 0.302] | 1.000 [0.541, 1.000] | n/a  | 0.004 [0.002, 0.006] | 1.000 [1.000, 1.000] | 0.000 [0.000, 0.000] |
```

## Reading it

- `cost` is `n/a` because no trial recorded monetary usage. Signal never fills that with zero.
- Intervals are wide because six batches are the independent unit. Repetitions measure stability, not sample size.
- `experiment.comparisons.sloppy` holds the paired advantage of `sloppy` over the baseline for every ruler that has a metric, with a cluster-bootstrap interval.
- `experiment.markdown()` gives the whole report; `experiment.toJSON()` is JSON-ready.

## Judges are raters, not graders

`rateTrials()` attaches a verdict per trial under a rater name. The deterministic grader is one rater; a human panel or a language-model judge run over the transcripts is another. `interRaterReliability()` (Krippendorff's alpha) and `agreementWithGrader()` tell you whether the judge measures the same thing. Until the alpha is high, the judge is not a ruler.

## When to predeclare

If a comparison will decide something (ship / don't ship, "not worse than"), declare it in `MeasurementConfig.confirmatoryComparisons` with a margin before running. See [Comparisons and power](#/comparisons).
