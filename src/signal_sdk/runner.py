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
    Episode, Function, Measurement, MeasurementConfig, TaskDistribution, Trial, ValidityPeriod,
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


def trial_seed(master_seed: int, episode: Episode, repetition: int) -> int:
    # A variant has the seed of its original, including across functions.
    identity = f"{master_seed}:{episode.variant_of or episode.id}:{repetition}"
    return int.from_bytes(sha256(identity.encode()).digest()[:4], "big")


def dataset_distribution(name: str, episodes: tuple[Episode, ...], *, label_rule: str,
                         hazard_rates: dict[str, float] | None = None, attack_suite_version: str | None = None,
                         top_cluster: str = "episode") -> TaskDistribution:
    """Bind an externally constructed book by its complete content hash."""
    return TaskDistribution(name=name, dataset_hash=content_hash(episodes), label_rule=label_rule,
                            hazard_rates=hazard_rates or {}, attack_suite_version=attack_suite_version,
                            top_cluster=top_cluster)


def _verify_book(distribution: TaskDistribution, episodes: tuple[Episode, ...], domain: Domain) -> None:
    if distribution.dataset_hash:
        if content_hash(episodes) != distribution.dataset_hash:
            raise ValueError("Episode content does not match the distribution dataset hash")
    elif domain.reproduce is None:
        raise ValueError("This domain cannot reproduce generated books; bind episodes with dataset_distribution")
    elif content_hash(episodes) != content_hash(domain.reproduce(distribution)):
        raise ValueError("Episodes do not reproduce the bound generator configuration")
    originals = {e.id: e for e in episodes if e.variant_of is None}
    for episode in episodes:
        if episode.variant_of:
            base = originals.get(episode.variant_of)
            if base is None or (base.label, base.cluster, base.ground_truth) != (
                    episode.label, episode.cluster, episode.ground_truth):
                raise ValueError("Variants must retain original label, cluster, and ground truth")


def _execute(implementation: FunctionImplementation, episode: Episode, repetition: int, seed: int,
             domain: Domain = RETURN_VALUES) -> Trial:
    trace = TraceRecorder()
    tools = domain.make_environment(episode, seed, trace)
    task = episode.input.get("task", episode.input) if isinstance(episode.input, dict) else episode.input
    trace.append_message("user", str(task))
    context = TrialContext(input=thaw(episode.input), tools=tools, trace=trace, seed=seed, repetition=repetition)
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
    return Trial(episode_id=episode.id, function_id=implementation.definition.id, repetition=repetition,
                 seed=seed, transcript=transcript, outcome=outcome,
                 grades=domain.grade(episode, transcript, outcome), error=error)


def measure(functions: tuple[FunctionImplementation, ...], distribution: TaskDistribution,
            episodes: tuple[Episode, ...], *, domain: Domain = RETURN_VALUES,
            config: MeasurementConfig | None = None, validity: ValidityPeriod | None = None,
            on_trial: Callable[[Trial], None] | None = None) -> Measurement:
    """Run the full crossing. Domain controls and self-validation are mandatory."""
    from .validation import self_validate

    config = config or MeasurementConfig(mode="real")
    if not functions:
        raise ValueError("Provide at least one function implementation")
    _verify_book(distribution, episodes, domain)
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
    for episode in episodes:
        for repetition in range(config.repetitions):
            seed = trial_seed(config.seed, episode, repetition)
            for implementation in implementations:
                trial = _execute(implementation, episode, repetition, seed, domain)
                trials.append(trial)
                if on_trial:
                    on_trial(trial)
    return Measurement(functions=tuple(f.definition for f in implementations), distribution=distribution,
                       environment=domain.environment, graders=domain.graders, validity=validity,
                       control_ids=tuple(c.definition.id for c in controls), episodes=episodes,
                       trials=tuple(trials), timestamp=now, config=config, validation=validation,
                       elapsed_seconds=perf_counter() - started)


def observation_rows(measurement: Measurement, *, include_variants: bool = False) -> list[dict]:
    """Flatten statistical inputs without treating perturbations as new book episodes."""
    episodes = {e.id: e for e in measurement.episodes}
    rows = []
    for trial in measurement.trials:
        episode = episodes[trial.episode_id]
        if episode.variant_of and not include_variants:
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
        rows.append({"episode_id": episode.id, "function_id": trial.function_id,
                     "repetition": trial.repetition, "seed": trial.seed, "cluster": episode.cluster,
                     "label": episode.label.value, "correct": trial.grades.outcome.correct,
                     "field_f1": trial.grades.outcome.field_f1,
                     "impossible_escalated": trial.grades.outcome.impossible_escalated,
                     **trial.grades.process.model_dump(), "attempted": attempted,
                     "occurred": occurred, "severity": severity,
                     **{f"metric:{k}": v for k, v in trial.grades.metrics.items()},
                     "risk_signal": signals[-1] if signals else None,
                     "variant_of": episode.variant_of,
                     "ground_truth_hash": content_hash(episode.ground_truth),
                     "outcome_signature": content_hash({"value": trial.outcome.value, "escalated": trial.outcome.escalated,
                                                        "actions": [(a.tool, a.arguments) for a in trial.outcome.actions]}),
                     "tool_fault": any(h.type == "tool_fault" for h in episode.hazards),
                     "execution_error": trial.error})
    return rows
