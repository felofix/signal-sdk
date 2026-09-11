---
title: FunctionImplementation
group: SDK reference
summary: A Function identity paired with the callable that runs it.
---

```ts
import { FunctionImplementation, type TrialContext } from "signal-sdk";

new FunctionImplementation<Tools>(
  definition: Function,
  execute: (context: TrialContext<Tools>) => unknown | Promise<unknown>,
  kind: "real" | "simulation" | "control" = "real",
)

interface TrialContext<Tools> { input: Json; tools: Tools; trace: TraceRecorder; seed: number; repetition: number }
```

## Example

```ts
async function run(context: TrialContext<ReturnValueTools>): Promise<string | null> {
  return context.trace.goal("Answer", async () => {
    const started = performance.now();
    const response = await client.messages.create({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: (context.input as { task: string }).task }] });
    context.trace.recordUsage({
      tokens: response.usage.input_tokens + response.usage.output_tokens, cost: null,
      durationMs: performance.now() - started,
      metadata: { providerVersion: response.model },
    });
    const text = response.content[0].text.trim();
    if (text === "ESCALATE") { context.tools.escalate("Model asked for a human"); return null; }
    return text;
  });
}

const implementation = new FunctionImplementation(fn, run, "real");
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `definition` | `Function` | required | The identity. |
| `execute` | `(context) => unknown \| Promise<unknown>` | required | Sync or async. Its return value is the outcome in the default environment and evidence elsewhere. |
| `kind` | `"real" \| "simulation" \| "control"` | `"real"` | Must match `MeasurementConfig.mode`. Controls are created by the runner. |

## TrialContext

| Field | Meaning |
|---|---|
| `input` | A mutable copy of `Scenario.input`. |
| `tools` | The environment's tools instance: whatever tools it exposes, plus `escalate()` in the built-ins. |
| `trace` | The `TraceRecorder`: `goal()`, `recordUsage()`, `recordSignal()`, `appendMessage()`. |
| `seed` | Deterministic per (scenario, repetition), identical across functions. Pass it to your provider when it supports one. |
| `repetition` | The repetition index. |

## Notes

The function never sees labels or ground states. `kind: "real"` trials must record at least one `model` step with a `providerVersion` in the function's declared versions; otherwise the trial is marked with an error and its usage is recorded as unreported.
