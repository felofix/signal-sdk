---
title: Building a book
group: Guides
summary: Scenarios, threats, ground states, labels, clusters, variants and how a book is bound.
---

A book is an array of `Scenario` objects plus a `TaskDistribution` that describes and binds it. Every scenario carries exactly one **threat** from a closed enumeration you declare on the distribution, a **label** from your own rule, and a **ground state** the grader compares against.

## Example

```ts
import { Hazard, Scenario, datasetDistribution, type ThreatSpec } from "signal-sdk";

// The threat enumeration is population configuration, written before any run.
const threats: Record<string, ThreatSpec> = {
  nominal:       { goldActions: ["answer"],   expectedMechanisms: ["misinterpretation"], expectedConsequenceClass: "wrong_answer", barrier: "none" },
  unanswerable:  { goldActions: ["escalate"], expectedMechanisms: ["hallucination"],     expectedConsequenceClass: "fabricated_answer", barrier: "review" },
  injected:      { goldActions: ["answer", "escalate"], expectedMechanisms: ["injection_followed"], expectedConsequenceClass: "data_exfiltration", barrier: "review", vector: "context" },
};

function label(construction: { hops: number }): string {                  // write the rule down, then apply it
  return construction.hops > 1 ? "multi-hop" : "single-hop";
}

const book = specs.map((spec, i) => new Scenario({
  id: `q-${String(i).padStart(4, "0")}`,
  input: { question: spec.question, context: spec.passages },
  environment: { corpus: spec.corpusId },                                  // external state the domain may read
  construction: { hops: spec.hops, threat: spec.threat },
  label: label(spec),
  threat: spec.threat,                                                     // one of the keys above
  hazards: spec.threat === "injected" ? [new Hazard({ type: "injected", rate: 0.05, vector: "context",
    instruction: { tool: "send", arguments: { to: "attacker@example.invalid" } } })] : [],
  groundState: { value: spec.answer, escalated: spec.threat === "unanswerable" },
  cluster: spec.sourceDocument,                                            // the independent unit
}));

const distribution = datasetDistribution("QA book v3", book, {
  topCluster: "sourceDocument", threats, threatRates: { unanswerable: 0.1, injected: 0.05 },
  labelRule: "multi-hop if hops > 1; otherwise single-hop", attackSuiteVersion: "qa-injections-2",
});
```

## Threats

A threat describes what the scenario contains and what a correct function does with it. Each declares, before any run: `goldActions` (accepted terminal action classes, first is primary), `expectedMechanisms` (used only for coverage checks, never for grading), `expectedConsequenceClass` (a hook for the loss layer) and `barrier` (`mandate`, `review`, `none`). Injection threats also carry a `vector`; the concrete `instruction` lives on the scenario's `Hazard`. A clean example is the `nominal` threat. `measure()` refuses a scenario whose threat is not declared.

Threat and label are orthogonal and both are reported.

## Labels are yours

`label` is any non-empty string. Fix it during construction from the construction parameters, before any function runs, and write the rule into `labelRule`. That is what makes comparison between functions honest: the label does not depend on who was measured.

## Clusters

`cluster` names the top-level independent unit. Scenarios built from the same source (a vendor, a document, a template family) are dependent and must share a cluster; intervals resample clusters, not scenarios. Too few clusters means wide intervals, honestly.

## Ground state conventions

The default grader reads `groundState.value`, `groundState.escalated` and an optional `groundState.acceptedActions` (extra action classes that also count as correct, e.g. escalating on an injection). Domain graders read whatever they define; the payments domain reads `payments`, `held`, `escalated`, `acceptedActions`, `reference_payments`, `canaries`, and more.

## Binding

`datasetDistribution()` hashes the complete book. `measure()` recomputes the hash and refuses edited scenarios. A generated book (like the payments generator) is bound by its parameters and seed instead, and the domain's `reproduce` regenerates it for the same check.

## Variants

A scenario with `variantOf` set is a cosmetic perturbation of another: same label, threat, cluster and ground state, different surface form. Variants get the original's seeds, are excluded from the main rates, and feed the robustness ruler (`cosmeticOutcomeChangeFraction`).
