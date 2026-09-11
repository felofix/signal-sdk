---
title: TraceRecorder
group: SDK reference
summary: Records every step of a trial; environments write to it, graders read from it.
---

```ts
import { TraceRecorder } from "@felofix/signal-sdk";

const trace = new TraceRecorder();
trace.goal<T>(name: string, block: () => T): T                    // sync or async block
trace.appendMessage(role: string, content: string): void
trace.recordUsage({ tokens: number | null; cost: number | null; durationMs?: number; name?: string; metadata?: JsonObject }): void
trace.recordSignal(probability: number, name = "risk_signal"): void
trace.recordTool<T>(name: string, args: JsonObject, call: () => T, options?: { stateChanging?: boolean }): T
trace.transcript(): Transcript
trace.steps: Step[]; trace.messages: Message[]
```

## Example

```ts
class Env implements Tools {
  private escalated = false;
  readonly input: Json;
  constructor(scenario: Scenario, readonly seed: number, readonly trace: TraceRecorder) { this.input = scenario.input; }

  lookup(key: string) {
    return this.trace.recordTool("lookup", { key }, () => ({ ok: true, value: TABLE.get(key) ?? null }));
  }
  escalate(reason = "") {
    return this.trace.recordTool("escalate", { reason }, () => { this.escalated = true; return { ok: true }; }, { stateChanging: true });
  }
  finish(returned: unknown) { return new Outcome({ value: returned, escalated: this.escalated }); }
}

// inside a function:
await context.trace.goal("Look things up", async () => {
  context.trace.recordSignal(0.2);            // before any state-changing call
  const hit = context.tools.lookup("k1");
  context.trace.recordUsage({ tokens: 812, cost: 0.0031, durationMs: 640, metadata: { providerVersion: "m-2026-08" } });
});
```

## Methods

| Method | What it records |
|---|---|
| `goal(name, block)` | Runs `block`; every step recorded inside carries `goal` / `parentGoal`. Works with async blocks. Shown as a tree in the trace explorer. |
| `appendMessage(role, content)` | A message with the current step index, so messages interleave with steps. |
| `recordUsage({...})` | A `model` step with actual tokens and cost. `null` means unreported; never pass zero for unknown. |
| `recordSignal(p)` | A `signal` step with a risk probability in [0, 1]. Refused after any `stateChanging` tool step. |
| `recordTool(name, args, call, { stateChanging })` | Runs `call()`, records a `tool` step with arguments, result, duration and a `retry` flag when the previous call of the same tool returned `toolFault`. `ValidationError`, `TypeError` and `RangeError` thrown by `call` become `{ ok: false, schemaError }` with `schemaValid: false`; other errors propagate. |
| `transcript()` | An immutable `Transcript` of all steps and messages so far. |

## Notes

Environments hold the recorder and expose the methods a function may use (`goal`, `recordUsage`, `recordSignal`, `appendMessage`). The runner adds a user message from `input.task` (or the whole input) before execution and an assistant message from the return value after it.
