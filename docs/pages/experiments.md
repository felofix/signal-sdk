---
title: Run an experiment
group: Get started
summary: Compare variants on one book, pick your rulers, attach a judge.
---

An experiment is several functions on the same book, read with the same rulers. Every function sees the same trajectories with the same seeds, so differences are paired. Comparisons are exploratory unless you predeclare them.

## Example

```python
from signal_sdk import (DEFAULT_RULERS, Function, FunctionImplementation, rate,
                        inter_rater_reliability, agreement_with_grader,
                        run_experiment, rate_trials, evaluate)
from signal_sdk.examples import add, arithmetic_book

distribution, book = arithmetic_book(24, seed=0)

def sloppy(context):
    result = add(context)
    return result + 1 if result is not None and result % 7 == 0 else result

variants = (
    FunctionImplementation(Function(name="add", implementation={"revision": "1"}), add, "simulation"),
    FunctionImplementation(Function(name="sloppy", implementation={"revision": "2"}), sloppy, "simulation"),
)
experiment = run_experiment("adders", variants, distribution, book, repetitions=2,
                            rulers=DEFAULT_RULERS + (rate("tokens"),), baseline="add")
print(experiment.table())

# Attach raters after the fact and measure whether they agree.
judged = rate_trials(experiment.measurement, "grader", lambda t, trial: trial.grades.outcome.correct)
judged = rate_trials(judged, "llm_judge", my_llm_judge)      # your callable: (trajectory, trial) -> verdict
reliability = evaluate("judged adders", judged, baseline="add",
                       rulers=(inter_rater_reliability(["grader", "llm_judge"]), agreement_with_grader("llm_judge")))
print(reliability.table())
```

```text
| Function                  | accuracy             | field_f1             | pass^k               | path_consistency     | cost | latency_ms           | steps                | tokens               |
|---|---|---|---|---|---|---|---|---|
| add                       | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | n/a  | 0.001 [0.000, 0.002] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.000] |
| sloppy                    | 0.875 [0.696, 1.000] | 0.875 [0.696, 1.000] | 0.875 [0.696, 1.000] | 1.000 [0.541, 1.000] | n/a  | 0.001 [0.000, 0.002] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.000] |
| never_escalate (control)  | 0.000 [0.000, 0.459] | 0.167 [0.031, 0.302] | 0.000 [0.000, 0.459] | 1.000 [0.541, 1.000] | n/a  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| always_escalate (control) | 0.167 [0.031, 0.302] | 0.167 [0.031, 0.302] | 0.167 [0.031, 0.302] | 1.000 [0.541, 1.000] | n/a  | 0.008 [0.008, 0.009] | 1.000 [1.000, 1.000] | 0.000 [0.000, 0.000] |
```

## Reading it

- `cost` is `n/a` because no trial recorded monetary usage. Signal never fills that with zero.
- Intervals are wide because six batches are the independent unit. Repetitions measure stability, not sample size.
- `experiment.comparisons["sloppy"]` holds the paired advantage of `sloppy` over the baseline for every ruler that has a metric, with a cluster-bootstrap interval.
- `experiment.markdown()` gives the whole report; `experiment.to_dict()` is JSON-ready.

## Judges are raters, not graders

`rate_trials()` attaches a verdict per trial under a rater name. The deterministic grader is one rater; a human panel or a language-model judge run over the transcripts is another. `inter_rater_reliability()` (Krippendorff's alpha) and `agreement_with_grader()` tell you whether the judge measures the same thing. Until the alpha is high, the judge is not a ruler.

## When to predeclare

If a comparison will decide something (ship / don't ship, "not worse than"), declare it in `MeasurementConfig.confirmatory_comparisons` with a margin before running. See [Comparisons and power](#/comparisons).
