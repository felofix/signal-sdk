---
title: Building a book
group: Guides
summary: Trajectories, labels, clusters, variants and how a book is bound.
---

A book is a tuple of `Trajectory` objects plus a `TaskDistribution` that describes and binds it. You construct trajectories with whatever inputs your function takes; the SDK only needs a label, a cluster and ground truth.

## Example

```python
from signal_sdk import Trajectory, Hazard, dataset_distribution

def label(construction):                       # write the rule down, then apply it
    if construction["fields_missing"]:
        return "unanswerable"
    return "multi-hop" if construction["hops"] > 1 else "single-hop"

book = []
for i, spec in enumerate(specs):               # your own construction parameters
    construction = {"hops": spec.hops, "fields_missing": spec.missing, "template": spec.template}
    book.append(Trajectory(
        id=f"q-{i:04d}",
        input={"question": spec.question, "context": spec.passages},
        environment={"corpus": spec.corpus_id},               # external state the domain may read
        construction=construction,
        label=label(construction),
        hazards=(Hazard(type="prompt_injection", rate=0.05, vector="context",
                        instruction={"tool": "send", "arguments": {"to": "attacker@example.invalid"}}),) if spec.injected else (),
        ground_truth={"value": spec.answer, "escalated": spec.missing},
        cluster=spec.source_document,                          # the independent unit
        template=spec.template,
    ))
book = tuple(book)

distribution = dataset_distribution(
    "QA book v3", book, top_cluster="source_document",
    label_rule="unanswerable if fields are missing; multi-hop if hops > 1; otherwise single-hop",
    hazard_rates={"prompt_injection": 0.05}, attack_suite_version="qa-injections-2",
)
```

## Labels are yours

`label` is any non-empty string. Fix it during construction from the construction parameters, before any function runs, and write the rule into `label_rule`. That is what makes comparison between functions honest: the label does not depend on who was measured. Rulers and the difficulty model condition on whatever labels you used.

## Clusters

`cluster` names the top-level independent unit. Trajectories built from the same source (a vendor, a document, a template family) are dependent and must share a cluster; intervals resample clusters, not trajectories. Too few clusters means wide intervals, honestly.

## Ground truth conventions

The default grader reads `ground_truth["value"]` and `ground_truth["escalated"]`. If `escalated` is true, the only correct outcome is an escalation with no value. Domain graders read whatever they define; the payments domain reads `payments`, `held`, `escalated`, `reference_payments`, `canaries`, and more.

## Binding

`dataset_distribution()` hashes the complete book. `measure()` recomputes the hash and refuses edited trajectories. A generated book (like the payments generator) is bound by its parameters and seed instead, and the domain's `reproduce` regenerates it for the same check.

## Variants

A trajectory with `variant_of` set is a cosmetic perturbation of another: same label, cluster and ground truth, different surface form. Variants get the original's seeds, are excluded from the main rates, and feed the robustness ruler (`cosmetic_outcome_change_fraction`).
