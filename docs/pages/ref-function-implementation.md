---
title: FunctionImplementation
group: SDK reference
summary: A Function identity paired with the callable that runs it.
---

```python
from signal_sdk import FunctionImplementation, TrialContext

FunctionImplementation(
    definition: Function,
    execute: Callable[[TrialContext], Any],
    kind: Literal["real", "simulation", "control"] = "real",
)

TrialContext(input: Any, tools: Any, trace: TraceRecorder, seed: int, repetition: int)
```

## Example

```python
def run(context: TrialContext) -> str:
    with context.trace.goal("Answer"):
        started = time.perf_counter()
        response = client.responses.create(model=MODEL, input=context.input["task"], seed=context.seed)
        context.trace.record_usage(
            tokens=response.usage.total_tokens, cost=None,
            duration_ms=(time.perf_counter() - started) * 1000,
            metadata={"provider_version": response.model},
        )
        if response.output_text.strip() == "ESCALATE":
            context.tools.escalate(reason="Model asked for a human")
            return None
        return response.output_text

implementation = FunctionImplementation(function, run, kind="real")
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `definition` | `Function` | required | The identity. |
| `execute` | `Callable[[TrialContext], Any]` | required | Synchronous. Its return value is the outcome in the default domain and evidence elsewhere. |
| `kind` | `"real" \| "simulation" \| "control"` | `"real"` | Must match `MeasurementConfig.mode`. Controls are created by the runner. |

## TrialContext

| Field | Meaning |
|---|---|
| `input` | A mutable copy of `Trajectory.input`. |
| `tools` | The domain's environment instance: whatever tools it exposes, plus `escalate()` in the built-ins. |
| `trace` | The `TraceRecorder`: `goal()`, `record_usage()`, `record_signal()`, `append_message()`. |
| `seed` | Deterministic per (trajectory, repetition), identical across functions. Pass it to your provider. |
| `repetition` | The repetition index. |

## Notes

The function never sees labels or ground truth. Returning an awaitable is an error: wrap async code in a synchronous adapter. `kind="real"` trials must record at least one `model` step with a `provider_version` in the function's declared versions; otherwise the trial is marked with an error and its usage is recorded as unreported.
