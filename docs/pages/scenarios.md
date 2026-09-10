---
title: Building a book
group: Guides
summary: Scenarios, ground states, labels, clusters, variants and how a book is bound.
---

A book is an array of `Scenario` objects plus a `TaskDistribution` that describes and binds it. You construct scenarios with whatever inputs your function takes; the SDK only needs a label, a cluster and a ground state.

## Example

```ts
import { Hazard, Scenario, datasetDistribution } from "signal-sdk";

function label(construction: { hops: number; fieldsMissing: boolean }): string {   // write the rule down, then apply it
  if (construction.fieldsMissing) return "unanswerable";
  return construction.hops > 1 ? "multi-hop" : "single-hop";
}

const book = specs.map((spec, i) => {
  const construction = { hops: spec.hops, fieldsMissing: spec.missing, template: spec.template };
  return new Scenario({
    id: `q-${String(i).padStart(4, "0")}`,
    input: { question: spec.question, context: spec.passages },
    environment: { corpus: spec.corpusId },                        // external state the domain may read
    construction,
    label: label(construction),
    hazards: spec.injected ? [new Hazard({ type: "prompt_injection", rate: 0.05, vector: "context",
      instruction: { tool: "send", arguments: { to: "attacker@example.invalid" } } })] : [],
    groundState: { value: spec.answer, escalated: spec.missing },  // what should be true afterwards
    cluster: spec.sourceDocument,                                  // the independent unit
    template: spec.template,
  });
});

const distribution = datasetDistribution("QA book v3", book, {
  topCluster: "sourceDocument",
  labelRule: "unanswerable if fields are missing; multi-hop if hops > 1; otherwise single-hop",
  hazardRates: { prompt_injection: 0.05 }, attackSuiteVersion: "qa-injections-2",
});
```

## Labels are yours

`label` is any non-empty string. Fix it during construction from the construction parameters, before any function runs, and write the rule into `labelRule`. That is what makes comparison between functions honest: the label does not depend on who was measured. Rulers and the difficulty model condition on whatever labels you used.

## Clusters

`cluster` names the top-level independent unit. Scenarios built from the same source (a vendor, a document, a template family) are dependent and must share a cluster; intervals resample clusters, not scenarios. Too few clusters means wide intervals, honestly.

## Ground state conventions

The default grader reads `groundState.value` and `groundState.escalated`. If `escalated` is true, the only correct outcome is an escalation with no value. Domain graders read whatever they define; the payments domain reads `payments`, `held`, `escalated`, `reference_payments`, `canaries`, and more.

## Binding

`datasetDistribution()` hashes the complete book. `measure()` recomputes the hash and refuses edited scenarios. A generated book (like the payments generator) is bound by its parameters and seed instead, and the domain's `reproduce` regenerates it for the same check.

## Variants

A scenario with `variantOf` set is a cosmetic perturbation of another: same label, cluster and ground state, different surface form. Variants get the original's seeds, are excluded from the main rates, and feed the robustness ruler (`cosmeticOutcomeChangeFraction`).
