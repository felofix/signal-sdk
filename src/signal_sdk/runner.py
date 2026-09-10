"""Crossed execution with isolated environments, controls, and a validation gate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256
from inspect import isawaitable
from pathlib import Path
from time import perf_counter
from typing import Any, Callable, Literal

from .controls import always_escalate, always_pay
from .environment import ToolEnvironment
from .generators import generate_book
from .graders import grade
from .models import (
    DocumentDistribution, Episode, Function, Mandate, Measurement, MeasurementConfig,
    ModelIdentity, Trial, ValidityPeriod, content_hash, thaw,
)


@dataclass(frozen=True)
class TrialContext:
    """The function sees input and tools, never labels or grading ground truth."""

    input: dict[str, Any]
    tools: ToolEnvironment
    seed: int
    repetition: int


@dataclass(frozen=True)
class FunctionImplementation:
    definition: Function
    execute: Callable[[TrialContext], Any]
    kind: Literal["real", "simulation", "control"] = "real"

    def __post_init__(self) -> None:
        if self.kind not in {"real", "simulation", "control"} or not callable(self.execute):
            raise ValueError("A function implementation needs a callable and a valid execution kind")


def control_functions(distribution: DocumentDistribution, episodes: tuple[Episode, ...],
                      validity: ValidityPeriod, currency: str = "USD") -> tuple[FunctionImplementation, ...]:
    """Controls have explicit broad mandates so their harmful attempts remain visible."""
    vendors, accounts, amounts = set(), set(), []
    for episode in episodes:
        for document in episode.environment.get("documents", ()):
            vendors.add(str(document.get("vendor", "")))
            accounts.add(str(document.get("account", "")))
            amounts.append(Decimal(str(document.get("amount", 0))))
    mandate = Mandate(amount_cap=max(amounts, default=Decimal(0)),
                      allowed_vendors=tuple(sorted(vendors)), allowed_accounts=tuple(sorted(accounts)), currency=currency)
    return tuple(FunctionImplementation(Function(
        name=name, model=ModelIdentity(provider="signal", name=name, version="1"),
        prompts=(name,), tool_descriptions={"payment_tools": "signal-payment-tools-v1"},
        toolset={"implementation": "signal-payment-tools-v1", "control": name},
        mandate=mandate, distribution_id=distribution.id, validity=validity,
    ), execute, "control") for name, execute in
        (("always_pay", always_pay), ("always_escalate", always_escalate)))


def trial_seed(master_seed: int, episode: Episode, repetition: int) -> int:
    # A variant has the seed of its original, including across functions.
    identity = f"{master_seed}:{episode.variant_of or episode.id}:{repetition}"
    return int.from_bytes(sha256(identity.encode()).digest()[:4], "big")


def _verify_book(distribution: DocumentDistribution, episodes: tuple[Episode, ...]) -> None:
    if distribution.dataset_hash:
        if content_hash(episodes) != distribution.dataset_hash:
            raise ValueError("Episode content does not match the distribution dataset hash")
    elif distribution.generator == "signal-payments-v1":
        params = distribution.parameters
        expected_distribution, expected = generate_book(
            params["count"], distribution.seed, variants=params["cosmetic_variants"],
            hazard_rates=thaw(distribution.hazard_rates), vendors=params["vendors"],
            templates=params["templates"], impossible_rate=params["impossible_rate"],
        )
        if distribution.id != expected_distribution.id or content_hash(episodes) != content_hash(expected):
            raise ValueError("Episodes do not reproduce the bound generator configuration")
    else:
        raise ValueError("For a custom generator, construct episodes then bind them with dataset_distribution")
    originals = {e.id: e for e in episodes if e.variant_of is None}
    for episode in episodes:
        if episode.variant_of:
            base = originals.get(episode.variant_of)
            if base is None or (base.label, base.cluster, base.ground_truth) != (
                    episode.label, episode.cluster, episode.ground_truth):
                raise ValueError("Variants must retain original label, cluster, and ground truth")


def _execute(implementation: FunctionImplementation, episode: Episode,
             repetition: int, seed: int) -> Trial:
    tools = ToolEnvironment(episode, implementation.definition.mandate, seed)
    tools.append_message("user", str(episode.input.get("task", episode.input)))
    context = TrialContext(input=tools.input, tools=tools, seed=seed, repetition=repetition)
    error = None
    try:
        response = implementation.execute(context)
        if isawaitable(response):
            if hasattr(response, "close"):
                response.close()
            raise TypeError("Use a synchronous adapter; execute returned an awaitable")
        if response is not None:
            tools.append_message("assistant", str(response))
        if implementation.kind == "real":
            model_steps = [s for s in tools.transcript().steps if s.kind == "model"]
            if not model_steps:
                raise ValueError("Real functions must record actual model usage and provider_version")
            if any(s.metadata.get("provider_version") != implementation.definition.model.version
                   for s in model_steps):
                raise ValueError("Observed provider version does not match the insured function")
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        tools.append_message("execution_error", error)
    if implementation.kind == "real" and not any(s.kind == "model" for s in tools.transcript().steps):
        tools.record_usage(tokens=None, cost=None, name="unreported_usage",
                           metadata={"usage_missing": True})
    transcript, outcome = tools.transcript(), tools.outcome()
    grades = grade(episode, transcript, outcome)
    return Trial(episode_id=episode.id, function_id=implementation.definition.id,
                 repetition=repetition, seed=seed, transcript=transcript,
                 outcome=outcome, grades=grades, error=error)


def measure(functions: tuple[FunctionImplementation, ...], distribution: DocumentDistribution,
            episodes: tuple[Episode, ...], *, config: MeasurementConfig | None = None,
            on_trial: Callable[[Trial], None] | None = None) -> Measurement:
    """Run the full crossing. Built-in controls and self-validation are mandatory."""
    from .validation import self_validate

    config = config or MeasurementConfig(mode="real")
    if config.grader_version != "signal-graders-v1":
        raise ValueError("Unsupported grader definition version")
    if not functions:
        raise ValueError("Provide at least one function implementation")
    _verify_book(distribution, episodes)
    now = datetime.now(UTC)
    if any(f.definition.distribution_id != distribution.id for f in functions):
        raise ValueError("A function is bound to a different distribution")
    if any(not f.definition.validity.start <= now < f.definition.validity.end for f in functions):
        raise ValueError("Measurement must occur within each function's validity period")
    if config.mode == "simulation" and any(f.kind == "real" for f in functions):
        raise ValueError("Real functions cannot run in simulation mode")
    if config.mode == "real" and any(f.kind != "real" for f in functions):
        raise ValueError("Real mode requires real function implementations")
    if any(f.definition.mandate.currency != config.currency for f in functions):
        raise ValueError("All functions and severity assumptions must use the measurement currency")
    if any(f.kind == "control" for f in functions):
        raise ValueError("Controls are added by the runner; supply measured functions only")
    definitions = {f.definition.id for f in functions}
    if len(definitions) != len(functions):
        raise ValueError("Function identities must be distinct")
    for comparison in config.confirmatory_comparisons:
        if not {comparison.reference_id, comparison.candidate_id} <= definitions:
            raise ValueError("Predeclared comparisons must reference supplied functions")
        if comparison.metric.startswith(("attempts:", "occurrences:")):
            raise ValueError("Confirmatory harm margins must use loss:<harm> in currency per 10,000")
    validation = self_validate()
    if validation["status"] != "PASS":
        raise RuntimeError("Self-validation failed; no function execution is allowed")
    validation["grader_definition"] = {
        "version": config.grader_version,
        "source_sha256": sha256(Path(__file__).with_name("graders.py").read_bytes()).hexdigest(),
    }
    validation["evidence_id"] = content_hash({k: v for k, v in validation.items() if k != "evidence_id"})
    controls = control_functions(distribution, episodes, functions[0].definition.validity, config.currency)
    implementations = (*functions, *controls)
    started = perf_counter()
    trials = []
    for episode in episodes:
        for repetition in range(config.repetitions):
            seed = trial_seed(config.seed, episode, repetition)
            for implementation in implementations:
                trial = _execute(implementation, episode, repetition, seed)
                trials.append(trial)
                if on_trial:
                    on_trial(trial)
    return Measurement(functions=tuple(f.definition for f in implementations),
                       distribution=distribution, episodes=episodes, trials=tuple(trials),
                       timestamp=now, config=config, validation=validation,
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
        signature = {"payments": [thaw(a.arguments) for a in trial.outcome.payments],
                     "emails": [thaw(a.arguments) for a in trial.outcome.emails],
                     "held": trial.outcome.held, "escalated": trial.outcome.escalated}
        rows.append({"episode_id": episode.id, "function_id": trial.function_id,
                     "repetition": trial.repetition, "seed": trial.seed, "cluster": episode.cluster,
                     "label": episode.label.value, "correct": trial.grades.outcome.correct,
                     "field_f1": trial.grades.outcome.field_f1,
                     "impossible_escalated": trial.grades.outcome.impossible_escalated,
                     **trial.grades.process.model_dump(), "attempted": attempted,
                     "occurred": occurred, "severity": severity,
                     "risk_signal": signals[-1] if signals else None,
                     "variant_of": episode.variant_of,
                     "ground_truth_hash": content_hash(episode.ground_truth),
                     "outcome_signature": content_hash(signature),
                     "tool_fault": any(h.type == "tool_fault" for h in episode.hazards),
                     "execution_error": trial.error})
    return rows
