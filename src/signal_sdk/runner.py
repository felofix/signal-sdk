"""Crossed execution with isolated environments, domain controls, and a validation gate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from inspect import isawaitable
from time import perf_counter
from typing import Callable, Literal

from .domain import RETURN_VALUES, Domain, Execute, TrialContext
from .models import (
    Trajectory, Function, Measurement, MeasurementConfig, TaskDistribution, Trial, ValidityPeriod,
    content_hash, thaw,
)
from .tracing import TraceRecorder


@dataclass(frozen=True)
class FunctionImplementation:
    definition: Function
    execute: Execute
    kind: Literal["real", "simulation", "control"] = "real"

    def __post_init__(self) -> None:
        if self.kind not in {"real", "simulation", "control"} or not callable(self.execute):
            raise ValueError("A function implementation needs a callable and a valid execution kind")


def control_functions(domain: Domain) -> tuple[FunctionImplementation, ...]:
    """Controls are functions like any other; their identity is the control itself."""
    return tuple(FunctionImplementation(Function(
        name=name, implementation={"control": name, "domain": domain.environment.name}), execute, "control")
        for name, execute in domain.controls)


def trial_seed(master_seed: int, trajectory: Trajectory, repetition: int) -> int:
    # A variant has the seed of its original, including across functions.
    identity = f"{master_seed}:{trajectory.variant_of or trajectory.id}:{repetition}"
    return int.from_bytes(sha256(identity.encode()).digest()[:4], "big")


def dataset_distribution(name: str, trajectories: tuple[Trajectory, ...], *, label_rule: str,
                         hazard_rates: dict[str, float] | None = None, attack_suite_version: str | None = None,
                         top_cluster: str = "trajectory") -> TaskDistribution:
    """Bind an externally constructed book by its complete content hash."""
    return TaskDistribution(name=name, dataset_hash=content_hash(trajectories), label_rule=label_rule,
                            hazard_rates=hazard_rates or {}, attack_suite_version=attack_suite_version,
                            top_cluster=top_cluster)


def _verify_book(distribution: TaskDistribution, trajectories: tuple[Trajectory, ...], domain: Domain) -> None:
    if distribution.dataset_hash:
        if content_hash(trajectories) != distribution.dataset_hash:
            raise ValueError("Trajectory content does not match the distribution dataset hash")
    elif domain.reproduce is None:
        raise ValueError("This domain cannot reproduce generated books; bind trajectories with dataset_distribution")
    elif content_hash(trajectories) != content_hash(domain.reproduce(distribution)):
        raise ValueError("Trajectories do not reproduce the bound generator configuration")
    originals = {e.id: e for e in trajectories if e.variant_of is None}
    for trajectory in trajectories:
        if trajectory.variant_of:
            base = originals.get(trajectory.variant_of)
            if base is None or (base.label, base.cluster, base.ground_truth) != (
                    trajectory.label, trajectory.cluster, trajectory.ground_truth):
                raise ValueError("Variants must retain original label, cluster, and ground truth")


def _execute(implementation: FunctionImplementation, trajectory: Trajectory, repetition: int, seed: int,
             domain: Domain = RETURN_VALUES) -> Trial:
    trace = TraceRecorder()
    tools = domain.make_environment(trajectory, seed, trace)
    task = trajectory.input.get("task", trajectory.input) if isinstance(trajectory.input, dict) else trajectory.input
    trace.append_message("user", str(task))
    context = TrialContext(input=thaw(trajectory.input), tools=tools, trace=trace, seed=seed, repetition=repetition)
    error, response = None, None
    try:
        response = implementation.execute(context)
        if isawaitable(response):
            if hasattr(response, "close"):
                response.close()
            raise TypeError("Use a synchronous adapter; execute returned an awaitable")
        if response is not None:
            trace.append_message("assistant", str(response))
        if implementation.kind == "real":
            model_steps = [s for s in trace.transcript().steps if s.kind == "model"]
            if not model_steps:
                raise ValueError("Real functions must record actual model usage and provider_version")
            versions = {m.version for m in implementation.definition.model_identities}
            if any(s.metadata.get("provider_version") not in versions for s in model_steps):
                raise ValueError("Observed provider version does not match the insured function")
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        trace.append_message("execution_error", error)
    if implementation.kind == "real" and not any(s.kind == "model" for s in trace.transcript().steps):
        trace.record_usage(tokens=None, cost=None, name="unreported_usage", metadata={"usage_missing": True})
    transcript, outcome = trace.transcript(), tools.finish(response)
    return Trial(trajectory_id=trajectory.id, function_id=implementation.definition.id, repetition=repetition,
                 seed=seed, transcript=transcript, outcome=outcome,
                 grades=domain.grade(trajectory, transcript, outcome), error=error)


def measure(functions: tuple[FunctionImplementation, ...], distribution: TaskDistribution,
            trajectories: tuple[Trajectory, ...], *, domain: Domain = RETURN_VALUES,
            config: MeasurementConfig | None = None, validity: ValidityPeriod | None = None,
            on_trial: Callable[[Trial], None] | None = None) -> Measurement:
    """Run the full crossing. Domain controls and self-validation are mandatory."""
    from .validation import self_validate

    config = config or MeasurementConfig(mode="real")
    if not functions:
        raise ValueError("Provide at least one function implementation")
    _verify_book(distribution, trajectories, domain)
    now = datetime.now(UTC)
    if validity and not validity.start <= now < validity.end:
        raise ValueError("Measurement must occur within its validity period")
    if config.mode == "simulation" and any(f.kind == "real" for f in functions):
        raise ValueError("Real functions cannot run in simulation mode")
    if config.mode == "real" and any(f.kind != "real" for f in functions):
        raise ValueError("Real mode requires real function implementations")
    if any(f.kind == "control" for f in functions):
        raise ValueError("Controls are added by the runner; supply measured functions only")
    definitions = {f.definition.id for f in functions}
    if len(definitions) != len(functions):
        raise ValueError("Function identities must be distinct")
    for comparison in config.confirmatory_comparisons:
        if not {comparison.reference_id, comparison.candidate_id} <= definitions:
            raise ValueError("Predeclared comparisons must reference supplied functions")
    validation = self_validate()
    if validation["status"] != "PASS":
        raise RuntimeError("Self-validation failed; no function execution is allowed")
    controls = control_functions(domain)
    implementations = (*functions, *controls)
    started = perf_counter()
    trials = []
    for trajectory in trajectories:
        for repetition in range(config.repetitions):
            seed = trial_seed(config.seed, trajectory, repetition)
            for implementation in implementations:
                trial = _execute(implementation, trajectory, repetition, seed, domain)
                trials.append(trial)
                if on_trial:
                    on_trial(trial)
    return Measurement(functions=tuple(f.definition for f in implementations), distribution=distribution,
                       environment=domain.environment, graders=domain.graders, validity=validity,
                       control_ids=tuple(c.definition.id for c in controls), trajectories=trajectories,
                       trials=tuple(trials), timestamp=now, config=config, validation=validation,
                       elapsed_seconds=perf_counter() - started)


def observation_rows(measurement: Measurement, *, include_variants: bool = False) -> list[dict]:
    """Flatten statistical inputs without treating perturbations as new book trajectories."""
    trajectories = {e.id: e for e in measurement.trajectories}
    rows = []
    for trial in measurement.trials:
        trajectory = trajectories[trial.trajectory_id]
        if trajectory.variant_of and not include_variants:
            continue
        attempted, occurred, severity = {}, {}, {}
        for event in trial.grades.events:
            keys = [event.harm]
            if event.vector and event.vector != "none":
                keys.append(f"{event.harm}/{event.vector}")
            for key in keys:
                attempted[key] = attempted.get(key, False) or event.attempted
                occurred[key] = occurred.get(key, False) or event.occurred
                severity[key] = severity.get(key, 0.0) + float(event.severity)
        signals = [s.result["risk_signal"] for s in trial.transcript.steps
                   if s.kind == "signal" and isinstance(s.result, dict) and "risk_signal" in s.result]
        rows.append({"trajectory_id": trajectory.id, "function_id": trial.function_id,
                     "repetition": trial.repetition, "seed": trial.seed, "cluster": trajectory.cluster,
                     "label": trajectory.label, "correct": trial.grades.outcome.correct,
                     "field_f1": trial.grades.outcome.field_f1,
                     "required_escalation_met": trial.grades.outcome.required_escalation_met,
                     "ratings": thaw(trial.grades.ratings),
                     **trial.grades.process.model_dump(), "attempted": attempted,
                     "occurred": occurred, "severity": severity,
                     **{f"metric:{k}": v for k, v in trial.grades.metrics.items()},
                     "risk_signal": signals[-1] if signals else None,
                     "variant_of": trajectory.variant_of,
                     "ground_truth_hash": content_hash(trajectory.ground_truth),
                     "outcome_signature": content_hash({"value": trial.outcome.value, "escalated": trial.outcome.escalated,
                                                        "actions": [(a.tool, a.arguments) for a in trial.outcome.actions]}),
                     "tool_fault": any(h.type == "tool_fault" for h in trajectory.hazards),
                     "execution_error": trial.error})
    return rows
