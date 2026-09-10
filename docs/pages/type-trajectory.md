---
title: Trajectory
group: Types
summary: Trajectory, Hazard and TaskDistribution.
---

```python
from signal_sdk import Trajectory, Hazard, TaskDistribution

Trajectory(
    id: str,
    input: Any,
    environment: dict[str, Any] = {},
    construction: dict[str, Any] = {},
    label: str,
    hazards: tuple[Hazard, ...] = (),
    ground_truth: dict[str, Any],
    cluster: str,
    template: str = "default",
    variant_of: str | None = None,
)

Hazard(type: str, rate: float, vector: str | None = None, instruction: dict = {}, canary: str | None = None)

TaskDistribution(
    name: str,
    generator: str | None = None, parameters: dict = {}, seed: int | None = None,
    dataset_hash: str | None = None,
    hazard_rates: dict[str, float] = {},
    label_rule: str,
    attack_suite_version: str | None = None,
    top_cluster: str = "trajectory",
)
```

## Example

```python
t = Trajectory(
    id="ticket-0412",
    input={"ticket": "I was charged twice, refund me", "customer_id": "c-77"},
    environment={"orders": [{"id": "o-1", "amount": "49.00"}, {"id": "o-2", "amount": "49.00"}]},
    construction={"duplicate_charge": True, "template": "refund"},
    label="refund",
    ground_truth={"value": {"action": "refund", "order": "o-2"}},
    cluster="c-77",
    template="refund",
)
print(t.content_id)
```

## Trajectory fields

| Name | | |
|---|---|---|
| `id` | required | Unique within the book. |
| `input` | required | Anything JSON-serialisable. The function receives a mutable copy. |
| `environment` | `{}` | External state the domain's environment reads. Never shown to the function directly. |
| `construction` | `{}` | The parameters the trajectory was built from; the label rule reads these. |
| `label` | required, non-empty | Any string, fixed before any function runs. |
| `hazards` | `()` | Injected dangers with known rates. |
| `ground_truth` | required | What the grader compares against. Default domain: `value`, `escalated`. |
| `cluster` | required | The independent unit for statistics. |
| `template` | `"default"` | Finer grouping, informational. |
| `variant_of` | `None` | Set on cosmetic perturbations of another trajectory. |

`content_id` is the SHA-256 of the trajectory. All fields are frozen, including nested mappings.

## TaskDistribution

Exactly one of `generator` (+ `seed`, `parameters`) or `dataset_hash` must be set. `hazard_rates` must be probabilities. `id` is the SHA-256 of the content.

## Hazard

`type` and `rate` are always known because the book was constructed. `vector` names where an injection lives (`document`, `email`, `tool_result`, …); `instruction` is `{"tool", "arguments"}` describing the harmful action a follower would take; `canary` is a string that must not leave.
