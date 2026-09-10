---
title: measure()
group: SDK reference
summary: Run the full crossing of functions × trajectories × repetitions and return an immutable Measurement.
---

```python
from signal_sdk import measure

measure(
    functions: tuple[FunctionImplementation, ...],
    distribution: TaskDistribution,
    trajectories: tuple[Trajectory, ...],
    *,
    domain: Domain = RETURN_VALUES,
    config: MeasurementConfig | None = None,
    validity: ValidityPeriod | None = None,
    on_trial: Callable[[Trial], None] | None = None,
) -> Measurement
```

Runs the self-validation gate, verifies the book against its distribution, adds the domain's two controls, then executes every function on every trajectory for `config.repetitions` repetitions with seeds shared across functions.

## Example

```python
from signal_sdk import FunctionImplementation, Function, MeasurementConfig, measure
from signal_sdk.domains.payments import generate_book, payments_domain, Mandate

distribution, book = generate_book(48, seed=7, vendors=16, variants=True)
domain = payments_domain(Mandate(amount_cap="1500", allowed_vendors=(...), allowed_accounts=(...),
                                 escalation_conditions=("duplicate", "bank_detail_change")))

measurement = measure(
    (FunctionImplementation(Function(name="reconcile", implementation={"revision": "9f3c1e2"}), reconcile, "simulation"),),
    distribution, book, domain=domain,
    config=MeasurementConfig(mode="simulation", repetitions=3, seed=7,
                             severity_assumptions={"wrong_account": {"distribution": "fixed", "amount": 100, "currency": "USD"}}),
    on_trial=lambda trial: print(trial.trajectory_id, trial.grades.outcome.correct),
)
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `functions` | `tuple[FunctionImplementation, ...]` | required | Distinct function identities to measure. Do not include controls. |
| `distribution` | `TaskDistribution` | required | The book's binding: dataset hash or generator parameters. |
| `trajectories` | `tuple[Trajectory, ...]` | required | The book. Must reproduce or hash to the distribution. |
| `domain` | `Domain` | `RETURN_VALUES` | Environment, graders and controls. |
| `config` | `MeasurementConfig` | `MeasurementConfig(mode="real")` | Repetitions, seed, bootstrap and loss settings, comparisons. |
| `validity` | `ValidityPeriod` | `None` | Period the measurement is valid for; the timestamp must fall inside it. |
| `on_trial` | `Callable[[Trial], None]` | `None` | Called with each completed trial, for progress or streaming storage. |

## Returns

An immutable `Measurement`. Its `id` is the SHA-256 of its content; `control_ids` lists the controls; `validation` holds the gate's evidence.

## Raises

- `RuntimeError` when self-validation fails: no function is executed.
- `ValueError` when the book does not match its distribution, function kinds do not match `config.mode`, identities are not distinct, a predeclared comparison names an unknown function, controls are supplied, or the timestamp is outside `validity`.

## Notes

`mode="real"` requires every implementation to be `kind="real"` and to record model usage with a `provider_version` matching a declared model; `mode="simulation"` refuses real implementations. An exception inside the function keeps everything recorded so far and marks the trial with `error`.
