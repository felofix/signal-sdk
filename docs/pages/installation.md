---
title: Installation
group: Get started
summary: Install from the repository and run the self-validation gate.
---

Signal needs Node 20 or newer. It is written in TypeScript, ships as ESM with type declarations, and has no runtime dependencies. The package name is `signal-sdk`; it is not on npm yet, so install from the repository.

## Example

```sh
git clone https://github.com/felofix/signal-sdk
cd signal-sdk
npm install                      # typescript and @types/node only
npm run build                    # tsc -> dist/
node dist/src/cli.js validate    # eight PASS/FAIL simulation checks
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
    {"name": "controls_separated", "status": "PASS"}
  ],
  "elapsedSeconds": 3.4
}
```

## Using it from another project

Until the npm release, point a dependency at the repository or a local tarball:

```sh
npm pack                                          # in the signal-sdk checkout -> signal-sdk-0.4.0.tgz
npm install ../signal-sdk/signal-sdk-0.4.0.tgz    # in your project
```

```ts
import { measure } from "signal-sdk";
import { paymentsDomain } from "signal-sdk/domains/payments";
import { certificates } from "signal-sdk/certificate";
import { summarize } from "signal-sdk/statistics";
```

## Scripts

| Script | Does |
|---|---|
| `npm run build` | Compile `src/`, `tests/` and `examples/` to `dist/`. |
| `npm test` | Build, then run the `node:test` suite. |
| `npm run lint` | `tsc --noEmit`. |
| `npm run docs` | Rebuild `docs/index.html` and `docs/llms.txt` from `docs/pages/`. |
