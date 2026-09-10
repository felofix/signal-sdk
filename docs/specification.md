# Specification Map

The SDK is TypeScript (ESM, Node 20+) with no runtime dependencies. It retains run
and visualisation capabilities through a trace recorder, goal hierarchy, HTML
explorer, terminal view and local API. No framework dependency is included.

| Requirement | Implementation | Important limit |
|---|---|---|
| Function identity | `Function`: models, prompts, implementation, configuration | Tools, mandate, distribution and period are external; `Measurement.bindingId` ties them to the function IDs. |
| External environment | `EnvironmentDefinition` supplied by a `Domain` | One environment per measurement; comparing environments means comparing measurements. |
| Tool-enforced mandate | `domains/payments` `ToolEnvironment` | Payment cap is per action; vendor/account/currency restrictions, no cumulative budget or email recipient rule. Other domains enforce their own. |
| Distribution binding | Domain `reproduce` for generated books or complete dataset hash | Custom label-rule correctness is the constructor's responsibility. |
| Scenarios, labels and hazards | `Scenario.label` is any string fixed by the creator; payments `generators` inject eight hazard types | The label rule is written into the distribution; the SDK never constrains the vocabulary. |
| Ground states | `Scenario.groundState` | What should be true afterwards; graders compare outcomes against it. |
| Crossed trials and seeds | `measure()` | Sync or async adapters; external provider seeds cannot be enforced remotely. |
| Transcript and actual outcome | `Step`, `Transcript`, `Outcome` | Instrumentation must observe all real tool effects. |
| Deterministic graders | `Domain.grade`, identified by `GraderDefinition` | Default grades return values; payments grades ten harms. No LLM judge anywhere. |
| Judges | `rateTrials()` ratings, `interRaterReliability()`, `agreementWithGrader()` | Ratings are experimental evidence; their reliability is measured; they never define insured harms. |
| Three columns | Outcome, event and process types and reports | No combined score. |
| Rulers and experiments | `Ruler`, `DEFAULT_RULERS`, `runExperiment()`, `evaluate()` | Comparisons in experiments are exploratory unless predeclared. |
| Two trivial controls | Every `Domain` declares them; the runner adds them | Default: never/always escalate; payments: always pay/always escalate. Controls share the measurement's environment. |
| Paired clustered comparisons | Scenario differences, top-cluster bootstrap | Independent exchangeable top clusters are an assumption. |
| Intervals and zero events | 95% intervals, bounded guards, plain-language zero note | Conservative small-cluster bounds; unavailable means are explicit. |
| Currency non-inferiority | Predeclared margins, strict lower-bound decision | Constant unbounded losses cannot establish NI. |
| Consistency and tails | pass^k, path consistency, actual cost distribution | Tool-name signature does not encode arguments. |
| Difficulty | Laplace-approximation logistic mixed model, function-by-label, scenario and scenario/function effects | Approximate Bayesian model; leave-function-out refits; dense Hessian capped at 2,500 coefficients. |
| New-book prediction | New random effects and outcomes over 10,000 scenarios | Width check may fail on a book; failure is reported, not hidden. |
| Multiplicity | Bonferroni family-wise intervals | Validity depends on marginal interval coverage; other analyses exploratory. |
| Power | Paired SD, ICC and cluster-size planning | Normal approximation; rare severe tails may need dedicated planning simulation. |
| Calibration | Pre-action signals, cluster training/test split, held-out curves | Review prevention and loss aggregation are assumptions, no router. |
| Robustness | Cosmetic outcome signatures and fault mishandling | Built-in perturbations are whitespace/layout changes only. |
| Loss per 10,000 | Assumed fixed/gamma/lognormal severity and beta/binomial frequency | No sum across overlapping classes; future excess cluster bursts not modeled. |
| Drift | Random audit selection, typed review evidence, bounded e-process | Completed independent clusters, common inclusion probability, upward changes. |
| Self-validation | Eight PASS/FAIL simulation and control checks | Selected planted regimes, not universal statistical certification. |
| Risk certificate | Ordered Markdown/JSON plus the three columns | Missing signals, severity assumptions, or usable designs are explicitly unavailable. |
| Pre/post report | Same scenarios/seeds, bound plan, paired results and both certificates | Different IDs are called different functions. |
| Generated limitations | Distribution/period/suite/severity/provider-update facts | A provider version change invalidates the measurement. |
| Numerics | `src/statistics/`: seeded xoshiro RNG, distributions, Cholesky | Hand-rolled and tested in-repo; no numeric library to trust. |
| Framework and domain neutrality | Callable, `TraceRecorder`, `Domain` protocol | No framework-specific dependency or automatic tracing adapter; the core has no notion of documents or payments. |

A release artifact is not an underwriting approval. No real model was measured as
part of the included demonstrations.
