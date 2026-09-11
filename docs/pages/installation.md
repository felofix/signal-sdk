---
title: Installation
group: Get started
summary: Install from the repository and run the self-validation gate.
---

Signal needs Node 20 or newer. It is written in TypeScript, ships as ESM with type declarations, and has no runtime dependencies. The package name is `@felofix/signal-sdk`; it is not on npm yet, so install from the repository.

## Example

```sh
git clone https://github.com/felofix/signal-sdk
cd signal-sdk
npm install                      # typescript and @types/node only
npm run build                    # tsc -> dist/
node dist/src/cli.js validate    # thirteen PASS/FAIL checks: statistics, then the bow-tie graders
```

```json
{
  "status": "PASS",
  "suiteVersion": "signal-self-validation-v1",
  "checks": [
    {"name": "cluster_interval_coverage", "status": "PASS", "simulatedCoverage": 0.967},
    {"name": "worse_function_rejected", "status": "PASS", "falseNoninferiorityConclusions": 0},
    {"name": "zero_events_not_zero_risk", "status": "PASS", "upperBound": 0.168},
    {"name": "difficulty_recovers_planted_order", "status": "PASS", "leaveFunctionOutCorrelations": [0.854, 0.887, 0.832]},
    {"name": "future_prediction_wider", "status": "PASS"},
    {"name": "calibration_cluster_separation", "status": "PASS"},
    {"name": "loss_recovers_planted_mean", "status": "PASS"},
    {"name": "threat_coverage", "status": "PASS", "scenariosPerThreat": {"nominal": 57, "missing_information": 11, "...": "..."}},
    {"name": "controls_differ_per_threat", "status": "PASS", "skippedBecauseGoldAcceptsBothControls": ["prompt_injection_document", "..."]},
    {"name": "controls_separated", "status": "PASS"},
    {"name": "expected_mechanisms_observed", "status": "PASS"},
    {"name": "primary_mechanism_unique", "status": "PASS", "wrongTrials": 285},
    {"name": "planted_hallucination_recovered", "status": "PASS", "plantedFraction": 0.5, "recovered": 0.475}
  ],
  "elapsedSeconds": 4.4
}
```

## Using it from another project

```sh
npm install @felofix/signal-sdk
```

```ts
import { measure } from "@felofix/signal-sdk";
import { paymentsEnvironment } from "@felofix/signal-sdk/environments/payments";
import { certificates } from "@felofix/signal-sdk/certificate";
import { summarize } from "@felofix/signal-sdk/statistics";
```

## Scripts

| Script | Does |
|---|---|
| `npm run build` | Compile `src/`, `tests/` and `examples/` to `dist/`. |
| `npm test` | Build, then run the `node:test` suite. |
| `npm run lint` | `tsc --noEmit`. |
| `npm run docs` | Rebuild `docs/index.html` and `docs/llms.txt` from `docs/pages/`. |
