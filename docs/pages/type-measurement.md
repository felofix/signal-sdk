---
title: Measurement
group: Types
summary: Measurement, MeasurementConfig, ConfirmatoryComparison, ComparisonPlan, ValidityPeriod.
---

```python
from signal_sdk import Measurement, MeasurementConfig, ConfirmatoryComparison, ComparisonPlan, ValidityPeriod

MeasurementConfig(
    repetitions: int = 3,                 # >= 2
    seed: int = 0,
    bootstrap_samples: int = 2000,        # >= 200
    loss_simulations: int = 5000,         # >= 200
    currency: str = "USD",
    severity_assumptions: dict[str, dict] = {},
    confirmatory_comparisons: tuple[ConfirmatoryComparison, ...] = (),
    prepost_plan: ComparisonPlan | None = None,
    calibration_target_residual_loss: float | None = None,
    mode: Literal["simulation", "real"] = "simulation",
)

ConfirmatoryComparison(name, reference_id, candidate_id, metric, margin, maximum_severity=None,
                       confirmatory=True, direction=None, unit=None, value_bounds=None)
ComparisonPlan(declared_at: datetime, comparisons: tuple[ConfirmatoryComparison, ...])
ValidityPeriod(start: datetime, end: datetime)      # timezone-aware, end > start
```

## Example

```python
config = MeasurementConfig(
    mode="real", repetitions=3, seed=2026,
    severity_assumptions={"wrong_account": {"distribution": "gamma", "mean": 500, "coefficient_of_variation": 1.5, "currency": "USD"}},
    confirmatory_comparisons=(
        ConfirmatoryComparison(name="accuracy", reference_id=a.id, candidate_id=b.id, metric="correct", margin=0.02),
        ConfirmatoryComparison(name="latency", reference_id=a.id, candidate_id=b.id, metric="metric:p95_latency",
                               margin=200, direction="lower", unit="ms"),
    ),
)
snapshot = measurement.model_dump_json()
restored = Measurement.model_validate_json(snapshot)
assert restored.id == measurement.id
```

## Measurement fields

| Name | Meaning |
|---|---|
| `schema_version` | `"2"`. |
| `functions` | All measured functions including controls. |
| `distribution`, `environment`, `graders` | The bound `TaskDistribution`, `EnvironmentDefinition`, `GraderDefinition`. |
| `validity` | Optional `ValidityPeriod`; the timestamp must fall inside it. |
| `control_ids` | Function IDs of the domain's controls. |
| `trajectories`, `trials` | The book and the complete crossing. |
| `timestamp` | Timezone-aware. |
| `config` | The `MeasurementConfig`. |
| `validation` | Self-validation evidence; must have `status: "PASS"`. |
| `elapsed_seconds` | Wall time of the run. |
| `id` | SHA-256 of the content. |
| `binding_id` | SHA-256 over function IDs, distribution, environment, graders and validity. |

Validation enforces a complete crossed design, identical seeds per (trajectory, repetition) across functions, unique IDs, and that any plan predates the measurement.

## Severity assumptions

Per harm: `{"distribution": "fixed" | "gamma" | "lognormal", "amount" | "mean": number, "coefficient_of_variation": number, "currency": str}`. The currency must equal `config.currency`. Missing assumptions mean no monetary loss is estimated for that harm.

## ConfirmatoryComparison

`metric` is `correct`, `field_f1`, `schema_valid`, `cost`, `latency_ms`, `tokens`, `steps`, `retries`, `loss:<harm>` or `metric:<name>`. Custom metrics need `direction` and `unit`. `margin` is in the metric's unit (currency per 10,000 for losses). `maximum_severity` bounds a trial's loss so the interval is identified.
