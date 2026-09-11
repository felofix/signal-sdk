---
title: Scenario
group: Types
summary: Scenario, Hazard, ThreatSpec and TaskDistribution.
---

```ts
import { Hazard, Scenario, TaskDistribution, type ThreatSpec } from "@felofix/signal-sdk";

new Scenario({
  id: string;
  input: Json;
  state?: JsonObject;           // {}
  construction?: JsonObject;          // {}
  label: string;                      // non-empty, your vocabulary
  threat?: string;                    // "nominal"; must be declared on the distribution
  hazards?: Hazard[];                 // []  concrete injected artefacts (vector, instruction, canary)
  groundState: JsonObject;            // what should be true afterwards
  cluster: string;
  template?: string;                  // "default"
  variantOf?: string | null;          // null
})

interface ThreatSpec {
  goldActions: string[];              // accepted terminal action classes; the first is the primary gold action
  expectedMechanisms: string[];       // plausible mechanisms if a function fails here; coverage checks only
  expectedConsequenceClass: string | null;   // loss class hook
  barrier: "mandate" | "review" | "none";
  vector?: string | null;             // injection threats only
}

new TaskDistribution({
  name: string;
  generator?: string | null; parameters?: JsonObject; seed?: number | null;
  datasetHash?: string | null;
  threats?: Record<string, ThreatSpec>;      // { nominal: NOMINAL_THREAT }
  threatRates?: Record<string, number>;      // construction probabilities per threat
  labelRule: string;
  attackSuiteVersion?: string | null;
  topCluster?: string;                       // "scenario"
})
```

## Example

```ts
const threats: Record<string, ThreatSpec> = {
  nominal: { goldActions: ["answer"], expectedMechanisms: ["misinterpretation"], expectedConsequenceClass: null, barrier: "none" },
  unanswerable: { goldActions: ["escalate"], expectedMechanisms: ["hallucination"], expectedConsequenceClass: "fabricated_answer", barrier: "review" },
};

const scenario = new Scenario({
  id: "ticket-0412",
  input: { ticket: "I was charged twice, refund me", customerId: "c-77" },
  state: { orders: [{ id: "o-1", amount: "49.00" }, { id: "o-2", amount: "49.00" }] },
  construction: { duplicateCharge: true, template: "refund" },
  label: "refund",
  threat: "nominal",
  groundState: { value: { action: "refund", order: "o-2" } },
  cluster: "c-77",
});
const distribution = datasetDistribution("Tickets", [scenario], { labelRule: "…", threats, topCluster: "customer" });
```

## Scenario fields

| Name | | |
|---|---|---|
| `id` | required | Unique within the book. |
| `input` | required | Anything JSON-serialisable. The function receives a mutable copy. |
| `state` | `{}` | External state the environment's tools read. Never shown to the function directly. |
| `construction` | `{}` | The parameters the scenario was built from; the label rule reads these. |
| `label` | required, non-empty | Any string, fixed before any function runs. |
| `threat` | `"nominal"` | Exactly one class from the distribution's `threats`. `measure()` refuses undeclared threats. |
| `hazards` | `[]` | Concrete injected artefacts for the threat: vector, the instruction a follower would execute, the canary. |
| `groundState` | required | What the grader compares against. Default environment: `value`, `escalated`, optional `acceptedActions`. |
| `cluster` | required | The independent unit for statistics. |
| `template` | `"default"` | Finer grouping, informational. |
| `variantOf` | `null` | Set on cosmetic perturbations of another scenario; variants keep label, threat, cluster and ground state. |

`contentId` is the SHA-256 of the scenario; `with(update)` returns a new validated scenario. All fields are deeply frozen.

## TaskDistribution

Exactly one of `generator` (+ `seed`, `parameters`) or `datasetHash` must be set. `threats` is the closed enumeration the book is drawn from; `threatRates` are construction probabilities and every key must name a declared threat. `id` is the SHA-256 of the content.

## Hazard

`type` and `rate` are always known because the book was constructed. `vector` names where an injection lives (`document`, `email`, `tool_result`, …); `instruction` is `{ tool, arguments }` describing the action a follower would take, which the `injection_followed` mechanism matches against; `canary` is a string that must not leave.
