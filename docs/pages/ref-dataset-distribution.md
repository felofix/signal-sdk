---
title: datasetDistribution()
group: SDK reference
summary: Bind a hand-built book by the hash of its complete content.
---

```ts
import { datasetDistribution } from "@felofix/signal-sdk";

datasetDistribution(
  name: string,
  scenarios: Scenario[],
  options: {
    labelRule: string;
    threats?: Record<string, ThreatSpec>;      // default: NOMINAL_THREAT for every threat name used in the book
    threatRates?: Record<string, number>;      // {}
    attackSuiteVersion?: string | null;        // null
    topCluster?: string;                       // "scenario"
  },
): TaskDistribution
```

## Example

```ts
const distribution = datasetDistribution("Support tickets v2", book, {
  labelRule: "refund if the ticket asks for money back; escalate if it mentions legal action; otherwise routine",
  threats, threatRates: { prompt_injection: 0.04 }, attackSuiteVersion: "tickets-inj-1",
  topCluster: "customer",
});
console.log(distribution.id, distribution.datasetHash?.slice(0, 12));
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `name` | `string` | required | Human name of the book. |
| `scenarios` | `Scenario[]` | required | The complete book; its content hash becomes `datasetHash`. |
| `options.labelRule` | `string` | required | The written rule that produced the labels. |
| `options.threats` | `Record<string, ThreatSpec>` | nominal spec per used name | The closed threat enumeration: gold actions, expected mechanisms, consequence class, barrier. |
| `options.threatRates` | `Record<string, number>` | `{}` | Construction probabilities per threat. |
| `options.attackSuiteVersion` | `string` | `null` | Names the injection suite; `null` means no adversarial content. |
| `options.topCluster` | `string` | `"scenario"` | What `Scenario.cluster` denotes. |

## Returns

A `TaskDistribution` with `datasetHash` set. `measure()` recomputes the hash and refuses a book that was edited afterwards.

## Notes

For generated books use the environment's generator (for example `generateBook` from `@felofix/signal-sdk/environments/payments`), which binds parameters and seed and lets the runner regenerate the book to verify it.
