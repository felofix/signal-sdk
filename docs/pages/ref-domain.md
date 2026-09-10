---
title: Domain
group: SDK reference
summary: Environment, graders and controls bundled for a kind of task.
---

```ts
import { Domain, RETURN_VALUES, ReturnValueEnvironment, fieldF1, processGrade } from "signal-sdk";

new Domain<Tools>({
  environment: EnvironmentDefinition;
  graders: GraderDefinition;
  makeEnvironment: (scenario: Scenario, seed: number, trace: TraceRecorder) => Environment & Tools;
  grade: (scenario: Scenario, transcript: Transcript, outcome: Outcome) => Grades;
  controls: [string, (context: TrialContext<Tools>) => unknown][];     // at least two
  reproduce?: ((distribution: TaskDistribution) => Scenario[]) | null;
})
```

## Example

```ts
import { Domain, GraderDefinition, Grades, OutcomeGrade, RETURN_VALUES, ReturnValueEnvironment, fieldF1, processGrade } from "signal-sdk";

const JSON_EXTRACTION = new Domain<ReturnValueEnvironment>({
  environment: RETURN_VALUES.environment.with({ name: "json-extraction" }),
  graders: new GraderDefinition({ name: "json-exact", version: "1", components: { outcome: "deep equality" } }),
  makeEnvironment: (scenario, seed, trace) => new ReturnValueEnvironment(scenario, seed, trace),
  grade: (scenario, transcript, outcome) => {
    const expected = scenario.groundState.value, got = outcome.value;
    return new Grades({
      outcome: new OutcomeGrade({ correct: JSON.stringify(got) === JSON.stringify(expected), fieldF1: fieldF1(expected, got) }),
      events: [], process: processGrade(transcript),
      metrics: { keys: got && typeof got === "object" ? Object.keys(got).length : 0 },
    });
  },
  controls: [["empty", () => ({})], ["always_escalate", (ctx) => ctx.tools.escalate()]],
});
```

## Fields

| Name | Type | | |
|---|---|---|---|
| `environment` | `EnvironmentDefinition` | required | Identity of the external world; bound to the measurement. |
| `graders` | `GraderDefinition` | required | Identity of the measurement definition. |
| `makeEnvironment` | `(scenario, seed, trace) => Environment` | required | Builds a fresh environment per trial. It must expose `trace` and `finish(returned): Outcome`. |
| `grade` | `(scenario, transcript, outcome) => Grades` | required | Pure and deterministic. |
| `controls` | at least two `[name, execute]` | required | Trivial functions the graders must separate. |
| `reproduce` | `(distribution) => Scenario[]` | `null` | Regenerates a generator-bound book so the runner can verify it. |

## RETURN_VALUES

The default domain. `ReturnValueEnvironment` exposes `input`, `escalate(reason?)`, `goal`, `recordUsage`, `recordSignal`, `appendMessage`, and `finish(returned)` returning `Outcome({ value: returned, escalated })`. `gradeReturnValue` marks a trial correct when `value` deep-equals `groundState.value`, or when the scenario requires escalation and the function escalated. Its one harm is `unnecessary_escalation`. Controls: `never_escalate`, `always_escalate`.

## Helpers

| Function | Returns |
|---|---|
| `processGrade(transcript)` | `ProcessGrade` from the recorded steps: schema validity, steps, retries, tokens, cost, latency, path signature. |
| `fieldF1(expected, actual)` | Token-level F1 over the leaves of two JSON values; `1` when both are empty. |

## Throws

`ValidationError` when fewer than two controls are given.
