---
title: rate_trials()
group: SDK reference
summary: Attach a rater's verdict to every trial and get a new snapshot.
---

```python
from signal_sdk import rate_trials

rate_trials(measurement: Measurement, rater: str,
            judge: Callable[[Trajectory, Trial], Any]) -> Measurement
```

This is how a human panel or a language-model judge enters an experiment: after the fact, over recorded transcripts, as a rating held alongside the deterministic grades. Rulers such as `inter_rater_reliability()` and `agreement_with_grader()` then measure whether the rater agrees with anyone.

## Example

```python
from signal_sdk import rate_trials, evaluate, inter_rater_reliability, agreement_with_grader

def llm_judge(trajectory, trial):
    verdict = client.responses.create(model=JUDGE, input=[
        {"role": "system", "content": "Answer PASS or FAIL."},
        {"role": "user", "content": f"Task: {trajectory.input}\nTranscript: {trial.transcript.model_dump_json()}\n"
                                    f"Outcome: {trial.outcome.model_dump_json()}"},
    ]).output_text.strip()
    return verdict == "PASS"

judged = rate_trials(measurement, "grader", lambda t, trial: trial.grades.outcome.correct)
judged = rate_trials(judged, "gpt-judge", llm_judge)
judged = rate_trials(judged, "human", lambda t, trial: human_labels[(t.id, trial.function_id, trial.repetition)])

report = evaluate("judge reliability", judged, rulers=(
    inter_rater_reliability(["grader", "gpt-judge", "human"]),
    inter_rater_reliability(["human", "gpt-judge"]),
    agreement_with_grader("gpt-judge"),
))
print(report.table())
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `measurement` | `Measurement` | required | The snapshot to annotate. |
| `rater` | `str` | required | Rater name; becomes the key in `Grades.ratings`. |
| `judge` | `Callable[[Trajectory, Trial], Any]` | required | Returns a categorical verdict. Booleans are read as correct/incorrect by `agreement_with_grader()`. |

## Returns

A new `Measurement` with `ratings[rater]` set on every trial. Its `id` changes because content changed; `validation`, functions and trajectories are untouched.

## Notes

Ratings are experimental evidence, not graders. They never enter `Event`s or the certificate's harm columns. The judge may be non-deterministic; that is exactly what reliability rulers measure.
