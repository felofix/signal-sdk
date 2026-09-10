"""Domain-neutral recording of what happened during one trial."""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from time import perf_counter
from typing import Any, Callable

from .models import Message, Step, Transcript


class TraceRecorder:
    """Every environment writes its steps and messages here; graders read the result."""

    def __init__(self) -> None:
        self._steps: list[Step] = []
        self._messages: list[Message] = []
        self._goals: list[str] = []

    @contextmanager
    def goal(self, name: str):
        """Attach goals and nested sub-goals to recorded execution steps."""
        self._goals.append(name)
        try:
            yield
        finally:
            self._goals.pop()

    def _goal_metadata(self) -> dict[str, Any]:
        return {"goal": self._goals[-1] if self._goals else None,
                "parent_goal": self._goals[-2] if len(self._goals) > 1 else None}

    def append_message(self, role: str, content: str) -> None:
        self._messages.append(Message(role=role, content=content, step_index=len(self._steps)))

    def record_usage(self, *, tokens: int | None, cost: float | None, duration_ms: float = 0.0,
                     name: str = "model", metadata: dict[str, Any] | None = None) -> None:
        """Record actual provider usage, including unknown cost as None."""
        if (tokens is not None and tokens < 0) or (cost is not None and cost < 0) or duration_ms < 0:
            raise ValueError("Usage values must be nonnegative")
        self._steps.append(Step(index=len(self._steps), kind="model", name=name, tokens=tokens,
                                cost=cost, duration_ms=duration_ms, metadata=metadata or {},
                                **self._goal_metadata()))

    def record_signal(self, probability: float, name: str = "risk_signal") -> None:
        """Record a runtime risk estimate before the first state-changing action."""
        if any(s.metadata.get("state_changing") for s in self._steps):
            raise ValueError("Calibration signals must be recorded before actions")
        if not 0 <= probability <= 1:
            raise ValueError("A risk signal must lie in [0, 1]")
        self._steps.append(Step(index=len(self._steps), kind="signal", name=name,
                                result={"risk_signal": probability}, cost=0, **self._goal_metadata()))

    def record_tool(self, name: str, arguments: dict[str, Any], call: Callable[[], Any], *,
                    state_changing: bool = False) -> Any:
        """Run a tool through the recorder; schema errors are recorded, never hidden."""
        started = perf_counter()
        previous = [s for s in self._steps if s.kind == "tool" and s.name == name]
        retry = bool(previous and isinstance(previous[-1].result, dict) and previous[-1].result.get("tool_fault"))
        schema_valid = True
        try:
            result = call()
        except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
            schema_valid = False
            result = {"ok": False, "schema_error": str(exc)}
        self._steps.append(Step(index=len(self._steps), kind="tool", name=name,
                                arguments=deepcopy(arguments), result=deepcopy(result),
                                duration_ms=(perf_counter() - started) * 1000, tokens=0, cost=0.0,
                                retry=retry, metadata={"schema_valid": schema_valid, "state_changing": state_changing},
                                **self._goal_metadata()))
        return deepcopy(result)

    def transcript(self) -> Transcript:
        return Transcript(steps=tuple(self._steps), messages=tuple(self._messages))
