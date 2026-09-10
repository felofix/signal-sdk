---
title: Function
group: SDK reference
summary: The identity of the system under test.
---

```python
from signal_sdk import Function, ModelIdentity

Function(
    implementation: dict[str, Any],
    model: ModelIdentity | None = None,
    models: tuple[ModelIdentity, ...] = (),
    prompts: tuple[str, ...] = (),
    configuration: dict[str, Any] = {},
    name: str = "function",
)

ModelIdentity(provider: str, name: str, version: str)
```

A function is what you are measuring and nothing else. Tools, mandate, documents and the period are external and belong to the measurement.

## Example

```python
function = Function(
    name="invoice-agent",
    model=ModelIdentity(provider="anthropic", name="claude-sonnet-5", version="claude-sonnet-5-20260812"),
    prompts=("Reconcile the invoice; escalate when authorization is missing.",),
    implementation={"repository": "org/agent", "revision": "9f3c1e2"},
    configuration={"temperature": 0, "max_steps": 12},
)
print(function.id)                 # sha256 over the four component hashes
print(function.component_hashes)   # {"models": ..., "prompts": ..., "implementation": ..., "configuration": ...}

variant = function.model_copy(update={"prompts": ("Reconcile the invoice.",)})
assert variant.id != function.id
```

## Fields

| Name | Type | | |
|---|---|---|---|
| `implementation` | `dict[str, Any]` | required, non-empty | Revision, content hash or coordinates of the code that runs. |
| `model` | `ModelIdentity` | `None` | The single model. Mutually exclusive with `models`. |
| `models` | `tuple[ModelIdentity, ...]` | `()` | Several models in one system. |
| `prompts` | `tuple[str, ...]` | `()` | Exact prompts. |
| `configuration` | `dict[str, Any]` | `{}` | Anything else that changes behaviour: temperature, step limits, feature flags. |
| `name` | `str` | `"function"` | Display name. Not part of the identity. |

## Computed

| Name | Meaning |
|---|---|
| `id` | SHA-256 of `component_hashes`. |
| `component_hashes` | One hash per component: `models`, `prompts`, `implementation`, `configuration`. |
| `model_identities` | `(model,)` or `models`. |

## Raises

`ValueError` when `implementation` is empty, when both `model` and `models` are given, or when a `ModelIdentity.version` is a moving alias (`latest`, `default`, `auto`, `current`).

## Notes

Per-model prompts and configuration for systems of interacting models are not yet modelled; today `prompts` and `configuration` are flat.
