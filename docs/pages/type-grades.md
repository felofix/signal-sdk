---
title: Grades and Outcome
group: Types
summary: Grades, OutcomeGrade, Event, ProcessGrade, Outcome, Action, Transcript, Step, Message, Trial.
---

```ts
import { Action, Event, Grades, Message, Outcome, OutcomeGrade, ProcessGrade, Step, Transcript, Trial } from "signal-sdk";

new Grades({ outcome: OutcomeGrade; events?: Event[]; process: ProcessGrade; metrics?: Record<string, number>; ratings?: JsonObject })
new OutcomeGrade({ correct: boolean; fieldF1: number; requiredEscalationMet?: boolean | null })
new Event({ harm: string; attempted: boolean; occurred: boolean; severity?: number; vector?: string | null; evidence?: number[] })
new ProcessGrade({ schemaValid: boolean; steps: number; retries: number; tokens: number | null; cost?: number | null; latencyMs: number; pathSignature: string })

new Outcome({ value?: unknown; actions?: Action[]; escalated?: boolean; state?: JsonObject })
new Action({ tool: string; arguments: JsonObject; callIndex: number })

new Transcript({ steps?: Step[]; messages?: Message[] })
new Step({ index, kind, name, arguments?, result?, durationMs?, tokens?, cost?, retry?, goal?, parentGoal?, metadata? })
new Message({ role: string; content: string; stepIndex?: number | null })

new Trial({ scenarioId, functionId, repetition, seed, transcript, outcome, grades, error? })
```

## Example

```ts
const trial = measurement.trials[0];
console.log(trial.grades.outcome);                    // OutcomeGrade { correct: true, fieldF1: 1, requiredEscalationMet: null }
for (const event of trial.grades.events) {
  if (event.attempted) console.log(event.harm, event.attempted, event.occurred, event.severity, event.evidence);
}
console.log(trial.transcript.steps.map((s) => [s.kind, s.name, s.goal]));
console.log(trial.outcome.actions);
```

```text
OutcomeGrade { correct: true, fieldF1: 1, requiredEscalationMet: null }
mandate_breach true false 0 [ 3 ]
[ [ 'tool', 'lookup_documents', 'Read documents' ], [ 'tool', 'lookup_vendor', 'Verify authorization' ],
  [ 'signal', 'risk_signal', 'Reconcile invoice' ], [ 'tool', 'pay', 'Resolve invoice' ] ]
[ Action { tool: 'pay', arguments: {...}, callIndex: 3 } ]
```

## The three columns

| Type | Fields |
|---|---|
| `OutcomeGrade` | `correct` against the ground state; `fieldF1` as continuous support; `requiredEscalationMet` when the scenario required escalation, else `null`. |
| `Event` | `attempted` (the function tried), `occurred` (it went through to the outcome), `severity` in currency, `vector` for injections, `evidence` step indices. |
| `ProcessGrade` | `schemaValid`, `steps`, `retries`, `tokens` and `cost` (`null` when unreported), `latencyMs`, `pathSignature` (SHA-256 of the ordered tool names). |

`metrics` holds domain-defined numbers; `ratings` holds rater verdicts attached by `rateTrials()`.

## Outcome

What the environment says happened. `value` is the return value (the outcome itself in the default domain); `actions` are the state-changing tool calls that succeeded; `escalated` is the escalation flag; `state` is any final environment state the domain wants graded.

## Step kinds

`tool` (recorded by `recordTool`, with `metadata.schemaValid` and `metadata.stateChanging`), `model` (usage), `signal` (risk probability in `result.riskSignal`). Indices are contiguous from zero. All of these are deeply frozen; `with(update)` on `Grades`, `Transcript` and `Trial` returns a new validated object.
