---
title: Limitations
group: Guides
summary: What a measurement does not say, generated from its configuration.
---

Every certificate carries a limitations section derived from the actual configuration. These are the standing ones.

- A measurement applies to one function, in one environment, on one distribution, under one grader definition, in one period. Any change is a new measurement.
- A model update at the provider invalidates the certificate even when the public model name stays the same. This is the reason measurement is a service, not a project.
- Severity is assumed. The loss distribution is a consequence of the printed assumption, never an observation.
- The attack suite is a lower bound. Injection is measured against a specific suite, not against all attacks. A book without hazards says nothing about adversarial inputs.
- The unit is the scenario. Repetitions are dependent; top-level clusters are assumed exchangeable and independent. Shared effects across declared clusters invalidate the intervals.
- Zero observed events is not zero risk; the upper bound (roughly 3/n with n independent units) is reported in plain language.
- Difficulty uses an approximate Bayesian mixed model fitted by Laplace approximation; its intervals are credible intervals, not frequentist coverage guarantees. Predictions for the next 10,000 scenarios assume the observed label mixture and cluster size.
- Calibration measures association between a runtime signal and attempted events; the review curve assumes review prevents loss. It is not a router.
- Drift is measured only on randomly selected, human-reviewed operational trials that were judged safe.
- Judge ratings are experimental evidence. Their reliability is measured; they do not define insured harms.
- Function adapters are trusted instrumentation. Content hashes are integrity checks, not signatures or timestamps.
- Self-validation passes finite seeded checks in selected regimes; it is not universal statistical validation.

## Example

```ts
import { limitations } from "signal-sdk/certificate";

for (const line of limitations(measurement, fn.id)) console.log("-", line);
```

```text
- This snapshot applies only to function 7681ac0f… on distribution 3f1c… in environment 9ab2… under graders 51d0…; no validity period was declared.
- A model update at the provider invalidates this certificate, even if the public model name stays the same. Re-measure with a pinned provider version.
- Changing the function (models, prompts, implementation, configuration) makes a new function. Changing the environment, its tools or mandate, the task distribution, the graders, or the period requires a new measurement.
- Severity is assumed. Configured severity distributions: {}.
- No attack suite was injected; this measurement says nothing about adversarial inputs.
- ...
- This is a simulation measurement. It makes no claim about a real provider-backed function.
- No severity assumptions were supplied, so a monetary loss distribution is not estimable.
```
