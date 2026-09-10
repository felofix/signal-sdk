---
title: Domain
group: SDK reference
summary: Environment, graders and controls bundled for a kind of task.
---

```python
from signal_sdk import Domain, RETURN_VALUES, ReturnValueEnvironment, process_grade, field_f1

Domain(
    environment: EnvironmentDefinition,
    graders: GraderDefinition,
    make_environment: Callable[[Trajectory, int, TraceRecorder], Environment],
    grade: Callable[[Trajectory, Transcript, Outcome], Grades],
    controls: tuple[tuple[str, Callable[[TrialContext], Any]], ...],
    reproduce: Callable[[TaskDistribution], tuple[Trajectory, ...]] | None = None,
)
```

## Example

```python
from signal_sdk import Domain, EnvironmentDefinition, GraderDefinition, ReturnValueEnvironment, Grades, OutcomeGrade, process_grade

def grade_json(trajectory, transcript, outcome):
    expected, got = trajectory.ground_truth["value"], outcome.value
    return Grades(outcome=OutcomeGrade(correct=got == expected, field_f1=field_f1(expected, got)),
                  events=(), process=process_grade(transcript),
                  metrics={"keys": float(len(got)) if isinstance(got, dict) else 0.0})

JSON_EXTRACTION = Domain(
    environment=RETURN_VALUES.environment.model_copy(update={"name": "json-extraction"}),
    graders=GraderDefinition(name="json-exact", version="1", components={"outcome": "dict equality"}),
    make_environment=ReturnValueEnvironment,
    grade=grade_json,
    controls=(("empty", lambda ctx: {}), ("always_escalate", lambda ctx: ctx.tools.escalate())),
)
```

## Fields

| Name | Type | | |
|---|---|---|---|
| `environment` | `EnvironmentDefinition` | required | Identity of the external world; bound to the measurement. |
| `graders` | `GraderDefinition` | required | Identity of the measurement definition. |
| `make_environment` | `(trajectory, seed, trace) -> Environment` | required | Builds a fresh environment per trial. It must expose `trace` and `finish(returned) -> Outcome`. |
| `grade` | `(trajectory, transcript, outcome) -> Grades` | required | Pure and deterministic. |
| `controls` | at least two `(name, execute)` | required | Trivial functions the graders must separate. |
| `reproduce` | `(distribution) -> trajectories` | `None` | Regenerates a generator-bound book so the runner can verify it. |

## RETURN_VALUES

The default domain. `ReturnValueEnvironment(trajectory, seed, trace)` exposes `input`, `escalate(reason="")`, `goal`, `record_usage`, `record_signal`, `append_message`, and `finish(returned)` returning `Outcome(value=returned, escalated=...)`. `grade_return_value` marks a trial correct when `value == ground_truth["value"]`, or when the trajectory requires escalation and the function escalated. Its one harm is `unnecessary_escalation`. Controls: `never_escalate`, `always_escalate`.

## Helpers

| Function | Returns |
|---|---|
| `process_grade(transcript)` | `ProcessGrade` from the recorded steps: schema validity, steps, retries, tokens, cost, latency, path signature. |
| `field_f1(expected, actual)` | Token-level F1 over the leaves of two JSON values; `1.0` when both are empty. |

## Raises

`ValueError` when fewer than two controls are given.
