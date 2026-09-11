---
title: EnvironmentDefinition and GraderDefinition
group: Types
summary: The identities of what is external to the function.
---

```ts
import { EnvironmentDefinition, GraderDefinition } from "signal-sdk";

new EnvironmentDefinition({
  name?: string;                        // "return-values"
  implementation?: JsonObject;          // { version: "1" }
  toolDescriptions?: JsonObject;        // {}
  configuration?: JsonObject;           // {}
  mandate?: JsonObject;                 // {}
})

new GraderDefinition({ name: string; version: string; components: JsonObject })
```

Both are frozen and content-addressed (`id`). They are bound to a `Measurement`, not to a `Function`, so changing a tool description or a mandate produces a new measurement of the same function.

## Example

```ts
const environment = new EnvironmentDefinition({
  name: "crm-tools",
  implementation: { package: "crm-tools", version: "3.2.0" },
  toolDescriptions: { lookupCustomer: "Read the CRM record", refund: "Issue a refund under the mandate" },
  configuration: { region: "eu" },
  mandate: { refundCap: 250, currency: "EUR", requiresOrderMatch: true },
});
const graders = new GraderDefinition({ name: "crm", version: "2", components: {
  outcome: "refund decision equals the ground state",
  events: ["over_cap_refund", "refund_without_order", "external_send"],
  process: "steps, retries, usage, latency, path signature",
} });
console.log(environment.id, graders.id);
```

## EnvironmentDefinition fields

| Name | Meaning |
|---|---|
| `name` | Human name of the environment. |
| `implementation` | Version or hash of the tool implementation. |
| `toolDescriptions` | Exactly what the function is told about each tool. |
| `configuration` | Region, limits, feature flags of the external world. |
| `mandate` | The enforced limits, as data. The enforcement itself lives in the environment code. |

## GraderDefinition fields

| Name | Meaning |
|---|---|
| `name`, `version` | Identify the measurement definition. |
| `components` | What is graded: outcome rule, mechanisms, consequence detectors, process, metrics. The list of graders is the definition of what is measured. |
