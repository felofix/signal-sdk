---
title: Scenario
group: Types
summary: Scenario, Hazard and TaskDistribution.
---

```ts
import { Hazard, Scenario, TaskDistribution } from "signal-sdk";

new Scenario({
  id: string;
  input: Json;
  environment?: JsonObject;           // {}
  construction?: JsonObject;          // {}
  label: string;                      // non-empty, your vocabulary
  hazards?: Hazard[];                 // []
  groundState: JsonObject;            // what should be true afterwards
  cluster: string;
  template?: string;                  // "default"
  variantOf?: string | null;          // null
})

new Hazard({ type: string; rate: number; vector?: string | null; instruction?: JsonObject; canary?: string | null })

new TaskDistribution({
  name: string;
  generator?: string | null; parameters?: JsonObject; seed?: number | null;
  datasetHash?: string | null;
  hazardRates?: Record<string, number>;
  labelRule: string;
  attackSuiteVersion?: string | null;
  topCluster?: string;                // "scenario"
})
```

## Example

```ts
const scenario = new Scenario({
  id: "ticket-0412",
  input: { ticket: "I was charged twice, refund me", customerId: "c-77" },
  environment: { orders: [{ id: "o-1", amount: "49.00" }, { id: "o-2", amount: "49.00" }] },
  construction: { duplicateCharge: true, template: "refund" },
  label: "refund",
  groundState: { value: { action: "refund", order: "o-2" } },
  cluster: "c-77",
  template: "refund",
});
console.log(scenario.contentId);
```

## Scenario fields

| Name | | |
|---|---|---|
| `id` | required | Unique within the book. |
| `input` | required | Anything JSON-serialisable. The function receives a mutable copy. |
| `environment` | `{}` | External state the domain's environment reads. Never shown to the function directly. |
| `construction` | `{}` | The parameters the scenario was built from; the label rule reads these. |
| `label` | required, non-empty | Any string, fixed before any function runs. |
| `hazards` | `[]` | Injected dangers with known rates. |
| `groundState` | required | What the grader compares against: the actions that should have happened and the state the system should end in. Default domain: `value`, `escalated`. |
| `cluster` | required | The independent unit for statistics. |
| `template` | `"default"` | Finer grouping, informational. |
| `variantOf` | `null` | Set on cosmetic perturbations of another scenario. |

`contentId` is the SHA-256 of the scenario; `with(update)` returns a new validated scenario. All fields are deeply frozen.

## TaskDistribution

Exactly one of `generator` (+ `seed`, `parameters`) or `datasetHash` must be set. `hazardRates` must be probabilities. `id` is the SHA-256 of the content.

## Hazard

`type` and `rate` are always known because the book was constructed. `vector` names where an injection lives (`document`, `email`, `tool_result`, …); `instruction` is `{ tool, arguments }` describing the harmful action a follower would take; `canary` is a string that must not leave.
