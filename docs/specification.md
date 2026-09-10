# Specification Map

This implementation is written from scratch. It retains run and visualisation
capabilities through a new trace recorder, goal hierarchy, HTML explorer, terminal
view and local API. No original source folder or framework dependency is included.

| Requirement | Implementation | Important limit |
|---|---|---|
| Function identity | `models.Function`: models, prompts, implementation, configuration | Tools, mandate, distribution and period are external; `Measurement.binding_id` ties them to the function IDs. |
| External environment | `models.EnvironmentDefinition` supplied by a `Domain` | One environment per measurement; comparing environments means comparing measurements. |
| Tool-enforced mandate | `domains.payments.ToolEnvironment` | Payment cap is per action; vendor/account/currency restrictions, no cumulative budget or email recipient rule. Other domains enforce their own. |
| Distribution binding | Domain `reproduce` for generated books or complete dataset hash | Custom label-rule correctness is the constructor's responsibility. |
| Constructed labels and hazards | `generators` | Built-in domain is invoice payment; eight configured hazard types. |
| Crossed trials and seeds | `runner.measure` | Synchronous trusted adapters; external provider seeds cannot be enforced remotely. |
| Transcript and actual outcome | `Step`, `Transcript`, `Outcome` | Instrumentation must observe all real tool effects. |
| Deterministic graders | `Domain.grade`, identified by `GraderDefinition` | Default grades return values; payments grades ten harms. No LLM judge anywhere. |
| Three columns | Outcome, event and process types and reports | No combined score. |
| Two trivial controls | Every `Domain` declares them; the runner adds them | Default: never/always escalate; payments: always pay/always escalate. Controls share the measurement's environment. |
| Paired clustered comparisons | Episode differences, top-cluster bootstrap | Independent exchangeable top clusters are an assumption. |
| Intervals and zero events | 95% intervals, bounded guards, plain-language zero note | Conservative small-cluster bounds; unavailable means are explicit. |
| Currency non-inferiority | Predeclared margins, strict lower-bound decision | Constant unbounded losses cannot establish NI. |
| Consistency and tails | pass^k, path consistency, actual cost distribution | Tool-name signature does not encode arguments. |
| Difficulty | Logistic mixed model, function-by-label, episode and episode/function effects | Approximate Bayesian model; leave-function-out refits; modest-book memory scale. |
| New-book prediction | New random effects and outcomes over 10,000 episodes | Width check may fail on a book; failure is reported, not hidden. |
| Multiplicity | Bonferroni family-wise intervals | Validity depends on marginal interval coverage; other analyses exploratory. |
| Power | Paired SD, ICC and cluster-size planning | Normal approximation; rare severe tails may need dedicated planning simulation. |
| Calibration | Pre-action signals, cluster training/test split, held-out curves | Review prevention and loss aggregation are assumptions, no router. |
| Robustness | Cosmetic outcome signatures and fault mishandling | Built-in perturbations are whitespace/layout changes only. |
| Loss per 10,000 | Assumed fixed/gamma/lognormal severity and beta/binomial frequency | No sum across overlapping classes; future excess cluster bursts not modeled. |
| Drift | Random audit selection, typed review evidence, bounded e-process | Completed independent clusters, common inclusion probability, upward changes. |
| Self-validation | Eight PASS/FAIL simulation and control checks | Selected planted regimes, not universal statistical certification. |
| Risk certificate | Ordered Markdown/JSON plus the three columns | Missing signals, severity assumptions, or usable designs are explicitly unavailable. |
| Pre/post report | Same episodes/seeds, bound plan, paired results and both certificates | Different IDs are called different functions. |
| Generated limitations | Distribution/period/suite/severity/provider-update facts | A provider version change invalidates the measurement. |
| Framework and domain neutrality | Ordinary callable, `TraceRecorder`, `Domain` protocol | No framework-specific dependency or automatic tracing adapter; the core has no notion of documents or payments. |

The proposed first release is an SDK for constructed measurement and method
inspection. A release artifact is not an underwriting approval. No real model was
measured as part of the included demonstration.
