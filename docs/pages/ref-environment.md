---
title: Environment
group: SDK reference
summary: Environment, graders and controls bundled for a kind of task.
---

```ts
import { Environment, RETURN_VALUES, ReturnValueTools, fieldF1, processGrade } from "@felofix/signal-sdk";

new Environment<T>({
  definition: EnvironmentDefinition;
  graders: GraderDefinition;
  makeTools: (scenario: Scenario, seed: number, trace: TraceRecorder) => Tools & T;
  grade: (scenario: Scenario, transcript: Transcript, outcome: Outcome) => Grades;
  controls: [string, (context: TrialContext<T>) => unknown][];     // at least two
  reproduce?: ((distribution: TaskDistribution) => Scenario[]) | null;
})
```

## Example

```ts
import { Environment, GraderDefinition, Grades, OutcomeGrade, RETURN_VALUES, ReturnValueTools, fieldF1, gradeMechanisms, processGrade } from "@felofix/signal-sdk";

const JSON_EXTRACTION = new Environment<ReturnValueTools>({
  definition: RETURN_VALUES.definition.with({ name: "json-extraction" }),
  graders: new GraderDefinition({ name: "json-exact", version: "1", components: { outcome: "deep equality" } }),
  makeTools: (scenario, seed, trace) => new ReturnValueTools(scenario, seed, trace),
  grade: (scenario, transcript, outcome) => {
    const expected = scenario.groundState.value, got = outcome.value;
    const correct = JSON.stringify(got) === JSON.stringify(expected);
    const outcomeGrade = new OutcomeGrade({ correct, fieldF1: fieldF1(expected, got), action: got === null ? "none" : "answer", goldAction: "answer",
      deviation: correct ? null : got === null ? "missing_action" : "wrong_value" });
    return new Grades({
      outcome: outcomeGrade,
      mechanism: gradeMechanisms(scenario, transcript, outcome, outcomeGrade, { mutatingTools: new Set(["escalate"]), provenanceFields: [] }),
      process: processGrade(transcript),
      metrics: { keys: got && typeof got === "object" ? Object.keys(got).length : 0 },
    });
  },
  controls: [["empty", () => ({})], ["always_escalate", (ctx) => ctx.tools.escalate()]],
});
```

## Fields

| Name | Type | | |
|---|---|---|---|
| `definition` | `EnvironmentDefinition` | required | Identity of the external world; bound to the measurement. |
| `graders` | `GraderDefinition` | required | Identity of the measurement definition. |
| `makeTools` | `(scenario, seed, trace) => Tools` | required | Builds fresh tools per trial. It must expose `trace` and `finish(returned): Outcome`. |
| `grade` | `(scenario, transcript, outcome) => Grades` | required | Pure and deterministic. |
| `controls` | at least two `[name, execute]` | required | Trivial functions the graders must separate. |
| `reproduce` | `(distribution) => Scenario[]` | `null` | Regenerates a generator-bound book so the runner can verify it. |

## RETURN_VALUES

The default environment. `ReturnValueTools` exposes `input`, `escalate(reason?)`, `goal`, `recordUsage`, `recordSignal`, `appendMessage`, and `finish(returned)` returning `Outcome({ value: returned, escalated })`. `gradeReturnValue` grades the terminal action (`answer` | `escalate` | `none`) against the ground state's gold action and `acceptedActions`, then deep-equality of the value; deviations are `wrong_action`, `missing_action` or `wrong_value`. Mechanisms come from `gradeMechanisms()` with `escalate` as the only mutating tool. Controls: `never_escalate`, `always_escalate`.

## Helpers

| Function | Returns |
|---|---|
| `processGrade(transcript)` | `ProcessGrade` from the recorded steps: schema validity, steps, retries, tokens, cost, latency, path signature. |
| `fieldF1(expected, actual)` | Token-level F1 over the leaves of two JSON values; `1` when both are empty. |

## Throws

`ValidationError` when fewer than two controls are given.
