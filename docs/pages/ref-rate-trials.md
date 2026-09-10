---
title: rateTrials()
group: SDK reference
summary: Attach a rater's verdict to every trial and get a new snapshot.
---

```ts
import { rateTrials } from "signal-sdk";

rateTrials(
  measurement: Measurement,
  rater: string,
  judge: (scenario: Scenario, trial: Trial) => unknown | Promise<unknown>,
): Promise<Measurement>
```

This is how a human panel or a language-model judge enters an experiment: after the fact, over recorded transcripts, as a rating held alongside the deterministic grades. Rulers such as `interRaterReliability()` and `agreementWithGrader()` then measure whether the rater agrees with anyone.

## Example

```ts
import { agreementWithGrader, evaluate, interRaterReliability, rateTrials } from "signal-sdk";

async function llmJudge(scenario: Scenario, trial: Trial): Promise<boolean> {
  const response = await client.messages.create({
    model: JUDGE, max_tokens: 5,
    system: "Answer PASS or FAIL.",
    messages: [{ role: "user", content: `Task: ${JSON.stringify(scenario.input)}\nTranscript: ${JSON.stringify(trial.transcript)}\nOutcome: ${JSON.stringify(trial.outcome)}` }],
  });
  return response.content[0].text.trim() === "PASS";
}

let judged = await rateTrials(measurement, "grader", (_s, trial) => trial.grades.outcome.correct);
judged = await rateTrials(judged, "llm-judge", llmJudge);
judged = await rateTrials(judged, "human", (s, trial) => humanLabels.get(`${s.id}:${trial.functionId}:${trial.repetition}`));

const report = evaluate("judge reliability", judged, [
  interRaterReliability(["grader", "llm-judge", "human"]),
  interRaterReliability(["human", "llm-judge"]),
  agreementWithGrader("llm-judge"),
]);
console.log(report.table());
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `measurement` | `Measurement` | required | The snapshot to annotate. |
| `rater` | `string` | required | Rater name; becomes the key in `Grades.ratings`. |
| `judge` | `(scenario, trial) => verdict` | required | Sync or async. Returns a categorical verdict; booleans are read as correct/incorrect by `agreementWithGrader()`. |

## Returns

A promise of a new `Measurement` with `ratings[rater]` set on every trial. Its `id` changes because content changed; `validation`, functions and scenarios are untouched.

## Notes

Ratings are experimental evidence, not graders. They never enter the outcome or mechanism columns. The judge may be non-deterministic; that is exactly what reliability rulers measure.
