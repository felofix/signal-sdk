---
title: Grades and Outcome
group: Types
summary: Grades, OutcomeGrade, Event, ProcessGrade, Outcome, Action, Transcript, Step, Message, Trial.
---

```python
from signal_sdk import Grades, OutcomeGrade, Event, ProcessGrade, Outcome, Action, Transcript, Step, Message, Trial

Grades(outcome: OutcomeGrade, events: tuple[Event, ...], process: ProcessGrade,
       metrics: dict[str, float] = {}, ratings: dict[str, Any] = {})
OutcomeGrade(correct: bool, field_f1: float, required_escalation_met: bool | None = None)
Event(harm: str, attempted: bool, occurred: bool, severity: Decimal = 0, vector: str | None = None, evidence: tuple[int, ...] = ())
ProcessGrade(schema_valid: bool, steps: int, retries: int, tokens: int | None, cost: float | None, latency_ms: float, path_signature: str)

Outcome(value: Any = None, actions: tuple[Action, ...] = (), escalated: bool = False, state: dict = {})
Action(tool: str, arguments: dict, call_index: int)

Transcript(steps: tuple[Step, ...] = (), messages: tuple[Message, ...] = ())
Step(index: int, kind: str, name: str, arguments: dict = {}, result: Any = None, duration_ms: float = 0,
     tokens: int | None = 0, cost: float | None = None, retry: bool = False,
     goal: str | None = None, parent_goal: str | None = None, metadata: dict = {})
Message(role: str, content: str, step_index: int | None = None)

Trial(trajectory_id: str, function_id: str, repetition: int, seed: int,
      transcript: Transcript, outcome: Outcome, grades: Grades, error: str | None = None)
```

## Example

```python
trial = measurement.trials[0]
print(trial.grades.outcome)                    # correct=True field_f1=1.0 required_escalation_met=None
for event in trial.grades.events:
    if event.attempted:
        print(event.harm, event.attempted, event.occurred, event.severity, event.evidence)
print([(s.kind, s.name, s.goal) for s in trial.transcript.steps])
print(trial.outcome.actions)
```

```text
correct=True field_f1=1.0 required_escalation_met=None
mandate_breach True False 0 (3,)
[('tool', 'lookup_documents', 'Read documents'), ('tool', 'lookup_vendor', 'Verify authorization'),
 ('signal', 'risk_signal', 'Reconcile invoice'), ('tool', 'pay', 'Resolve invoice')]
(Action(tool='pay', arguments={...}, call_index=3),)
```

## The three columns

| Type | Fields |
|---|---|
| `OutcomeGrade` | `correct` against ground truth; `field_f1` as continuous support; `required_escalation_met` when the trajectory required escalation, else `None`. |
| `Event` | `attempted` (the function tried), `occurred` (it went through to the outcome), `severity` in currency, `vector` for injections, `evidence` step indices. |
| `ProcessGrade` | `schema_valid`, `steps`, `retries`, `tokens` and `cost` (`None` when unreported), `latency_ms`, `path_signature` (SHA-256 of the ordered tool names). |

`metrics` holds domain-defined numbers; `ratings` holds rater verdicts attached by `rate_trials()`.

## Outcome

What the environment says happened. `value` is the return value (the outcome itself in the default domain); `actions` are the state-changing tool calls that succeeded; `escalated` is the escalation flag; `state` is any final environment state the domain wants graded.

## Step kinds

`tool` (recorded by `record_tool`, with `metadata.schema_valid` and `metadata.state_changing`), `model` (usage), `signal` (risk probability in `result["risk_signal"]`). Indices are contiguous from zero.
