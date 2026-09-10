---
title: dataset_distribution()
group: SDK reference
summary: Bind a hand-built book by the hash of its complete content.
---

```python
from signal_sdk import dataset_distribution

dataset_distribution(
    name: str,
    trajectories: tuple[Trajectory, ...],
    *,
    label_rule: str,
    hazard_rates: dict[str, float] | None = None,
    attack_suite_version: str | None = None,
    top_cluster: str = "trajectory",
) -> TaskDistribution
```

## Example

```python
distribution = dataset_distribution(
    "Support tickets v2", book,
    label_rule="refund if the ticket asks for money back; escalate if it mentions legal action; otherwise routine",
    hazard_rates={"prompt_injection": 0.04}, attack_suite_version="tickets-inj-1",
    top_cluster="customer",
)
print(distribution.id, distribution.dataset_hash[:12])
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `name` | `str` | required | Human name of the book. |
| `trajectories` | `tuple[Trajectory, ...]` | required | The complete book; its content hash becomes `dataset_hash`. |
| `label_rule` | `str` | required | The written rule that produced the labels. |
| `hazard_rates` | `dict[str, float]` | `{}` | Construction probabilities of injected hazards. |
| `attack_suite_version` | `str` | `None` | Names the injection suite; `None` means no adversarial content. |
| `top_cluster` | `str` | `"trajectory"` | What `Trajectory.cluster` denotes. |

## Returns

A `TaskDistribution` with `dataset_hash` set. `measure()` recomputes the hash and refuses a book that was edited afterwards.

## Notes

For generated books use the domain's generator (for example `signal_sdk.domains.payments.generate_book`), which binds parameters and seed and lets the runner regenerate the book to verify it.
