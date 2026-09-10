"""The external side of a measurement: environment, graders and controls.

A function under test only sees ``TrialContext``. Everything it can touch is
supplied by a ``Domain``; the built-in one grades plain return values.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Callable, Iterable, Protocol

from .models import (
    EnvironmentDefinition, Trajectory, Event, Grades, GraderDefinition, Outcome, OutcomeGrade,
    ProcessGrade, TaskDistribution, Transcript, thaw,
)
from .tracing import TraceRecorder


class Environment(Protocol):
    """What a domain hands to the function, plus how the runner closes the trial."""

    trace: TraceRecorder

    def finish(self, returned: Any) -> Outcome: ...


@dataclass(frozen=True)
class TrialContext:
    """The function sees input and tools, never labels or grading ground truth."""

    input: Any
    tools: Any
    trace: TraceRecorder
    seed: int
    repetition: int


Grader = Callable[[Trajectory, Transcript, Outcome], Grades]
Execute = Callable[[TrialContext], Any]


@dataclass(frozen=True)
class Domain:
    environment: EnvironmentDefinition
    graders: GraderDefinition
    make_environment: Callable[[Trajectory, int, TraceRecorder], Environment]
    grade: Grader
    controls: tuple[tuple[str, Execute], ...]
    reproduce: Callable[[TaskDistribution], tuple[Trajectory, ...]] | None = None

    def __post_init__(self) -> None:
        if len(self.controls) < 2:
            raise ValueError("A domain needs at least two trivial controls; a grader that cannot separate them is broken")


def process_grade(transcript: Transcript) -> ProcessGrade:
    calls = [step for step in transcript.steps if step.kind == "tool"]
    signature = sha256(json.dumps([step.name for step in calls], separators=(",", ":")).encode()).hexdigest()
    return ProcessGrade(
        schema_valid=all(step.metadata.get("schema_valid", True)
                         and not (isinstance(step.result, dict) and step.result.get("schema_error")) for step in calls),
        steps=len(transcript.steps), retries=sum(step.retry for step in transcript.steps),
        tokens=None if any(step.tokens is None for step in transcript.steps) else sum(step.tokens for step in transcript.steps),
        cost=None if any(step.cost is None for step in transcript.steps) else sum(step.cost for step in transcript.steps),
        latency_ms=sum(step.duration_ms for step in transcript.steps), path_signature=signature,
    )


def _leaves(value: Any, prefix: str = "") -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        for key, item in sorted(value.items()):
            yield from _leaves(item, f"{prefix}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            yield from _leaves(item, f"{prefix}[{index}]")
    else:
        yield prefix, json.dumps(value, sort_keys=True, default=str)


def field_f1(expected: Any, actual: Any) -> float:
    """Token overlap of leaf fields; 1.0 when both are empty."""
    target, observed = Counter(_leaves(thaw(expected))), Counter(_leaves(thaw(actual)))
    total = sum(target.values()) + sum(observed.values())
    return 1.0 if total == 0 else 2 * sum((target & observed).values()) / total


class ReturnValueEnvironment:
    """No tools except escalation; the outcome is whatever the function returned."""

    def __init__(self, trajectory: Trajectory, seed: int, trace: TraceRecorder) -> None:
        self.trace = trace
        self.seed = seed
        self.input = thaw(trajectory.input)
        self._escalated = False
        self.goal, self.append_message = trace.goal, trace.append_message
        self.record_usage, self.record_signal = trace.record_usage, trace.record_signal

    def escalate(self, reason: str = "") -> dict[str, Any]:
        def act() -> dict[str, Any]:
            self._escalated = True
            return {"ok": True, "escalated": True}
        return self.trace.record_tool("escalate", {"reason": reason}, act, state_changing=True)

    def finish(self, returned: Any) -> Outcome:
        return Outcome(value=thaw(returned), escalated=self._escalated)


def grade_return_value(trajectory: Trajectory, transcript: Transcript, outcome: Outcome) -> Grades:
    """Correct means the returned value equals ground_truth["value"], or escalation when required."""
    truth = trajectory.ground_truth
    must_escalate = bool(truth.get("escalated", False))
    expected = None if must_escalate else thaw(truth.get("value"))
    correct = outcome.escalated == must_escalate and (must_escalate or thaw(outcome.value) == expected)
    escalations = tuple(s.index for s in transcript.steps if s.kind == "tool" and s.name == "escalate")
    unnecessary = Event(harm="unnecessary_escalation", attempted=bool(escalations) and not must_escalate,
                        occurred=outcome.escalated and not must_escalate, evidence=escalations)
    return Grades(
        outcome=OutcomeGrade(correct=correct, field_f1=field_f1(expected, outcome.value),
                             required_escalation_met=outcome.escalated if must_escalate else None),
        events=(unnecessary,), process=process_grade(transcript),
    )


def _never_escalate(context: TrialContext) -> None:
    return None


def _always_escalate(context: TrialContext) -> None:
    context.tools.escalate(reason="Always-escalate control")


RETURN_VALUES = Domain(
    environment=EnvironmentDefinition(name="return-values", implementation={"version": "1"},
                                      tool_descriptions={"escalate": "Hand the task to a human."}),
    graders=GraderDefinition(name="return-value", version="1",
                             components={"outcome": "value equality and escalation", "events": ["unnecessary_escalation"],
                                         "process": "steps, retries, usage, latency, path signature"}),
    make_environment=ReturnValueEnvironment, grade=grade_return_value,
    controls=(("never_escalate", _never_escalate), ("always_escalate", _always_escalate)),
)
