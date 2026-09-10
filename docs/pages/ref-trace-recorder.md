---
title: TraceRecorder
group: SDK reference
summary: Records every step of a trial; environments write to it, graders read from it.
---

```python
from signal_sdk import TraceRecorder

trace = TraceRecorder()
trace.goal(name: str)                                   # context manager
trace.append_message(role: str, content: str) -> None
trace.record_usage(*, tokens: int | None, cost: float | None, duration_ms: float = 0.0,
                   name: str = "model", metadata: dict | None = None) -> None
trace.record_signal(probability: float, name: str = "risk_signal") -> None
trace.record_tool(name: str, arguments: dict, call: Callable[[], Any], *, state_changing: bool = False) -> Any
trace.transcript() -> Transcript
```

## Example

```python
class Env:
    def __init__(self, trajectory, seed, trace):
        self.trace, self.input = trace, dict(trajectory.input)
        self._escalated = False

    def lookup(self, key):
        return self.trace.record_tool("lookup", {"key": key}, lambda: {"ok": True, "value": TABLE.get(key)})

    def escalate(self, reason=""):
        def act():
            self._escalated = True
            return {"ok": True}
        return self.trace.record_tool("escalate", {"reason": reason}, act, state_changing=True)

    def finish(self, returned):
        return Outcome(value=returned, escalated=self._escalated)

# inside a function:
with context.trace.goal("Look things up"):
    context.trace.record_signal(0.2)          # before any state-changing call
    hit = context.tools.lookup("k1")
    context.trace.record_usage(tokens=812, cost=0.0031, duration_ms=640, metadata={"provider_version": "m-2026-08"})
```

## Methods

| Method | What it records |
|---|---|
| `goal(name)` | Nests every step recorded inside as `goal` / `parent_goal`. Shown as a tree in the trace explorer. |
| `append_message(role, content)` | A message with the current step index, so messages interleave with steps. |
| `record_usage(...)` | A `model` step with actual tokens and cost. `None` means unreported; never pass zero for unknown. |
| `record_signal(p)` | A `signal` step with a risk probability in [0, 1]. Refused after any `state_changing` tool step. |
| `record_tool(name, arguments, call, state_changing=False)` | Runs `call()`, records a `tool` step with arguments, result, duration and a `retry` flag when the previous call of the same tool returned `tool_fault`. `KeyError`, `TypeError`, `ValueError` and `ArithmeticError` from `call` become `{"ok": False, "schema_error": ...}` with `schema_valid=False`; they are never swallowed silently. |
| `transcript()` | An immutable `Transcript` of all steps and messages so far. |

## Notes

Environments hold the recorder and expose the methods a function may use (`goal`, `record_usage`, `record_signal`, `append_message`). The runner adds a user message from `input["task"]` (or the whole input) before execution and an assistant message from the return value after it.
