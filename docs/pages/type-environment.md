---
title: EnvironmentDefinition and GraderDefinition
group: Types
summary: The identities of what is external to the function.
---

```python
from signal_sdk import EnvironmentDefinition, GraderDefinition

EnvironmentDefinition(
    name: str = "return-values",
    implementation: dict[str, Any] = {"version": "1"},
    tool_descriptions: dict[str, Any] = {},
    configuration: dict[str, Any] = {},
    mandate: dict[str, Any] = {},
)

GraderDefinition(name: str, version: str, components: dict[str, Any])
```

Both are frozen and content-addressed (`id`). They are bound to a `Measurement`, not to a `Function`, so changing a tool description or a mandate produces a new measurement of the same function.

## Example

```python
env = EnvironmentDefinition(
    name="crm-tools",
    implementation={"package": "crm_tools", "version": "3.2.0"},
    tool_descriptions={"lookup_customer": "Read the CRM record", "refund": "Issue a refund under the mandate"},
    configuration={"region": "eu"},
    mandate={"refund_cap": "250.00", "currency": "EUR", "requires_order_match": True},
)
graders = GraderDefinition(name="crm", version="2", components={
    "outcome": "refund decision equals ground truth",
    "events": ["over_cap_refund", "refund_without_order", "external_send"],
    "process": "steps, retries, usage, latency, path signature",
})
print(env.id, graders.id)
```

## EnvironmentDefinition fields

| Name | Meaning |
|---|---|
| `name` | Human name of the environment. |
| `implementation` | Version or hash of the tool implementation. |
| `tool_descriptions` | Exactly what the function is told about each tool. |
| `configuration` | Region, limits, feature flags of the external world. |
| `mandate` | The enforced limits, as data. The enforcement itself lives in the environment code. |

## GraderDefinition fields

| Name | Meaning |
|---|---|
| `name`, `version` | Identify the measurement definition. |
| `components` | What is graded: outcome rule, harm classes, process, metrics. The list of graders is the definition of what is measured. |
