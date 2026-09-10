"""Immutable concepts and canonical identities for constructed risk measurement."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


class FrozenDict(dict):
    """A JSON-compatible mapping that rejects ordinary nested mutation."""

    def _deny(self, *args: Any, **kwargs: Any) -> None:
        raise TypeError("Measurement data is immutable")

    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _deny

    def __copy__(self) -> FrozenDict:
        return self

    def __deepcopy__(self, memo: dict) -> FrozenDict:
        return self


def freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return FrozenDict({key: freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    return value


def thaw(value: Any) -> Any:
    """Return mutable JSON data; use for isolated constructed environment state."""
    if isinstance(value, BaseModel):
        return thaw(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return {key: thaw(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(item) for item in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(thaw(value), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def strip_computed(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k not in cls.model_computed_fields}
        return data

    @model_validator(mode="after")
    def freeze_nested(self) -> FrozenModel:
        for name in type(self).model_fields:
            object.__setattr__(self, name, freeze(getattr(self, name)))
        return self

    def model_copy(self, *, update: dict[str, Any] | None = None, deep: bool = False) -> Any:
        data = self.model_dump(mode="python", exclude_computed_fields=True)
        data.update(update or {})
        return type(self).model_validate(data)


class Label(str, Enum):
    """A suggested vocabulary. Labels are free strings; the creator of a book decides the rule."""

    EASY = "easy"
    COMPLEX = "complex"
    IMPOSSIBLE = "impossible"


class ModelIdentity(FrozenModel):
    provider: str = Field(min_length=1)
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)

    @model_validator(mode="after")
    def pinned_version(self) -> ModelIdentity:
        if self.version.strip().lower() in {"latest", "default", "auto", "current"}:
            raise ValueError("A model version identifier must be pinned, not a moving alias")
        return self


class ValidityPeriod(FrozenModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def ordered(self) -> ValidityPeriod:
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("Validity boundaries must include a timezone")
        if self.end <= self.start:
            raise ValueError("Validity end must follow start")
        return self


class TaskDistribution(FrozenModel):
    name: str = Field(min_length=1)
    generator: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    seed: int | None = None
    dataset_hash: str | None = None
    hazard_rates: dict[str, float] = Field(default_factory=dict)
    label_rule: str = Field(min_length=1)
    attack_suite_version: str | None = None
    top_cluster: str = "trajectory"

    @model_validator(mode="after")
    def construction_bound(self) -> TaskDistribution:
        if (self.generator is None) == (self.dataset_hash is None):
            raise ValueError("Supply either generator parameters with seed or a dataset hash")
        if self.generator is not None and self.seed is None:
            raise ValueError("A generated distribution needs a seed")
        if any(not 0 <= rate <= 1 for rate in self.hazard_rates.values()):
            raise ValueError("Hazard rates must be probabilities")
        return self

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))


class Function(FrozenModel):
    """Only the system under test; external resources never enter this identity."""

    implementation: dict[str, Any]
    model: ModelIdentity | None = None
    models: tuple[ModelIdentity, ...] = ()
    prompts: tuple[str, ...] = ()
    configuration: dict[str, Any] = Field(default_factory=dict)
    name: str = "function"

    @model_validator(mode="after")
    def implementation_bound(self) -> Function:
        if not self.implementation:
            raise ValueError("Identify the tested implementation with a revision or content hash")
        if self.model is not None and self.models:
            raise ValueError("Use model for a single model or models for multiple models")
        return self

    @property
    def model_identities(self) -> tuple[ModelIdentity, ...]:
        return (self.model,) if self.model else self.models

    @computed_field
    @property
    def component_hashes(self) -> dict[str, str]:
        return {
            "models": content_hash(self.model_identities),
            "prompts": content_hash(self.prompts),
            "implementation": content_hash(self.implementation),
            "configuration": content_hash(self.configuration),
        }

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.component_hashes)


class EnvironmentDefinition(FrozenModel):
    """External conditions, tools and enforcement, bound to a measurement."""

    name: str = "return-values"
    implementation: dict[str, Any] = Field(default_factory=lambda: {"version": "1"})
    tool_descriptions: dict[str, Any] = Field(default_factory=dict)
    configuration: dict[str, Any] = Field(default_factory=dict)
    mandate: dict[str, Any] = Field(default_factory=dict)

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))


class GraderDefinition(FrozenModel):
    name: str
    version: str
    components: dict[str, Any]

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))


class Hazard(FrozenModel):
    type: str
    rate: float = Field(ge=0, le=1)
    vector: str | None = None
    instruction: dict[str, Any] = Field(default_factory=dict)
    canary: str | None = None


class Trajectory(FrozenModel):
    id: str
    input: Any
    environment: dict[str, Any] = Field(default_factory=dict)
    construction: dict[str, Any] = Field(default_factory=dict)
    label: str = Field(min_length=1)
    hazards: tuple[Hazard, ...] = ()
    ground_truth: dict[str, Any]
    cluster: str
    template: str = "default"
    variant_of: str | None = None

    @field_validator("label", mode="before")
    @classmethod
    def plain_label(cls, value: Any) -> Any:
        return value.value if isinstance(value, Enum) else value

    @computed_field
    @property
    def content_id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))


class Message(FrozenModel):
    role: str
    content: str
    step_index: int | None = Field(default=None, ge=0)


class Step(FrozenModel):
    index: int = Field(ge=0)
    kind: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    duration_ms: float = Field(default=0, ge=0)
    tokens: int | None = Field(default=0, ge=0)
    cost: float | None = Field(default=None, ge=0)
    retry: bool = False
    goal: str | None = None
    parent_goal: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Transcript(FrozenModel):
    steps: tuple[Step, ...] = ()
    messages: tuple[Message, ...] = ()

    @model_validator(mode="after")
    def sequence(self) -> Transcript:
        if [step.index for step in self.steps] != list(range(len(self.steps))):
            raise ValueError("Transcript step indices must be contiguous and ordered")
        return self


class Action(FrozenModel):
    tool: str
    arguments: dict[str, Any]
    call_index: int = Field(ge=0)


class Outcome(FrozenModel):
    value: Any = None
    actions: tuple[Action, ...] = ()
    escalated: bool = False
    state: dict[str, Any] = Field(default_factory=dict)


class Event(FrozenModel):
    harm: str
    attempted: bool
    occurred: bool
    severity: Decimal = Field(default=Decimal("0"), ge=0)
    vector: str | None = None
    evidence: tuple[int, ...] = ()


class OutcomeGrade(FrozenModel):
    correct: bool
    field_f1: float = Field(ge=0, le=1)
    required_escalation_met: bool | None = None


class ProcessGrade(FrozenModel):
    schema_valid: bool
    steps: int = Field(ge=0)
    retries: int = Field(ge=0)
    tokens: int | None = Field(ge=0)
    cost: float | None = Field(default=None, ge=0)
    latency_ms: float = Field(ge=0)
    path_signature: str


class Grades(FrozenModel):
    """Three columns plus optional extras; nothing here is ever combined into one score."""

    outcome: OutcomeGrade
    events: tuple[Event, ...]
    process: ProcessGrade
    metrics: dict[str, float] = Field(default_factory=dict)
    ratings: dict[str, Any] = Field(default_factory=dict)


class Trial(FrozenModel):
    trajectory_id: str
    function_id: str
    repetition: int = Field(ge=0)
    seed: int = Field(ge=0)
    transcript: Transcript
    outcome: Outcome
    grades: Grades
    error: str | None = None


class ConfirmatoryComparison(FrozenModel):
    name: str
    reference_id: str
    candidate_id: str
    metric: str
    margin: float = Field(ge=0)
    maximum_severity: float | None = Field(default=None, gt=0)
    confirmatory: bool = True
    direction: Literal["higher", "lower"] | None = None
    unit: str | None = None
    value_bounds: tuple[float, float] | None = None

    @model_validator(mode="after")
    def supported_metric(self) -> ConfirmatoryComparison:
        standard = {"correct", "cost", "latency_ms", "tokens", "steps", "retries", "schema_valid", "field_f1"}
        if self.metric not in standard and not self.metric.startswith(("loss:", "metric:")):
            raise ValueError("Use a process/outcome metric, loss:<harm>, or metric:<custom_name>")
        if self.metric in {"loss:", "metric:"}:
            raise ValueError("A comparison must name its metric")
        if self.metric.startswith("metric:") and (self.direction is None or self.unit is None):
            raise ValueError("Custom metric comparisons require an explicit direction and unit")
        if self.value_bounds and self.value_bounds[0] >= self.value_bounds[1]:
            raise ValueError("Metric lower bound must be below its upper bound")
        return self


class ComparisonPlan(FrozenModel):
    declared_at: datetime
    comparisons: tuple[ConfirmatoryComparison, ...]

    @model_validator(mode="after")
    def registered(self) -> ComparisonPlan:
        if self.declared_at.tzinfo is None or not self.comparisons:
            raise ValueError("A plan needs a timezone-aware declaration time and comparisons")
        if len({c.name for c in self.comparisons}) != len(self.comparisons):
            raise ValueError("Comparison names must be unique")
        return self

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))


class MeasurementConfig(FrozenModel):
    repetitions: int = Field(default=3, ge=2)
    seed: int = Field(default=0, ge=0)
    bootstrap_samples: int = Field(default=2000, ge=200)
    loss_simulations: int = Field(default=5000, ge=200)
    currency: str = "USD"
    severity_assumptions: dict[str, Any] = Field(default_factory=dict)
    confirmatory_comparisons: tuple[ConfirmatoryComparison, ...] = ()
    prepost_plan: ComparisonPlan | None = None
    calibration_target_residual_loss: float | None = Field(default=None, ge=0)
    mode: Literal["simulation", "real"] = "simulation"

    @model_validator(mode="after")
    def controls_required(self) -> MeasurementConfig:
        if self.prepost_plan and self.confirmatory_comparisons:
            raise ValueError("Use one pre/post plan for the entire confirmatory family, not separate comparison declarations")
        for assumption in self.severity_assumptions.values():
            if assumption.get("currency") != self.currency:
                raise ValueError("Severity assumptions must use the measurement currency")
        return self


class Measurement(FrozenModel):
    schema_version: Literal["2"] = "2"
    functions: tuple[Function, ...]
    distribution: TaskDistribution
    environment: EnvironmentDefinition
    graders: GraderDefinition
    validity: ValidityPeriod | None = None
    control_ids: tuple[str, ...] = ()
    trajectories: tuple[Trajectory, ...]
    trials: tuple[Trial, ...]
    timestamp: datetime
    config: MeasurementConfig
    validation: dict[str, Any]
    elapsed_seconds: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def crossed(self) -> Measurement:
        trajectory_ids = {e.id for e in self.trajectories}
        function_ids = {f.id for f in self.functions}
        if not trajectory_ids or len(trajectory_ids) != len(self.trajectories):
            raise ValueError("Trajectories must be nonempty and have unique IDs")
        if not function_ids or len(function_ids) != len(self.functions):
            raise ValueError("Functions must be nonempty and have unique IDs")
        if self.timestamp.tzinfo is None:
            raise ValueError("Measurement timestamp needs a timezone")
        if self.validation.get("status") != "PASS":
            raise ValueError("A measurement must bind passing self-validation evidence")
        if self.config.prepost_plan and self.config.prepost_plan.declared_at > self.timestamp:
            raise ValueError("A comparison plan must be declared before measurement")
        if self.validity and not self.validity.start <= self.timestamp < self.validity.end:
            raise ValueError("Measurement timestamp is outside its validity period")
        if not set(self.control_ids) <= function_ids:
            raise ValueError("Control identities must belong to the measured crossing")
        expected = {(e, f, r) for e in trajectory_ids for f in function_ids
                    for r in range(self.config.repetitions)}
        observed = {(t.trajectory_id, t.function_id, t.repetition) for t in self.trials}
        if observed != expected or len(observed) != len(self.trials):
            raise ValueError("Measurement must have a complete crossed trial design")
        seeds: dict[tuple[str, int], int] = {}
        for trial in self.trials:
            key = (trial.trajectory_id, trial.repetition)
            if key in seeds and seeds[key] != trial.seed:
                raise ValueError("All functions must use the same seeds for paired trials")
            seeds[key] = trial.seed
        comparisons = self.config.confirmatory_comparisons
        if len({c.name for c in comparisons}) != len(comparisons):
            raise ValueError("Confirmatory comparison names must be unique")
        return self

    @computed_field
    @property
    def id(self) -> str:
        return content_hash(self.model_dump(mode="json", exclude_computed_fields=True))

    @computed_field
    @property
    def binding_id(self) -> str:
        return content_hash({"functions": [f.id for f in self.functions],
                             "distribution": self.distribution.id, "environment": self.environment.id,
                             "graders": self.graders.id, "validity": self.validity})


class AuditSample(FrozenModel):
    trajectory_id: str
    function_id: str
    cluster: str
    timestamp: datetime
    judged_safe: bool
    selected_for_audit: bool
    inclusion_probability: float = Field(gt=0, le=1)
    attempted: dict[str, bool]
    cost: float = Field(ge=0)
    human_reviewed: bool = True

    @model_validator(mode="after")
    def unbiased(self) -> AuditSample:
        if self.timestamp.tzinfo is None:
            raise ValueError("An audit timestamp needs a timezone")
        if not (self.judged_safe and self.selected_for_audit and self.human_reviewed):
            raise ValueError("Drift accepts only randomly audited, human-reviewed safe trajectories")
        return self
