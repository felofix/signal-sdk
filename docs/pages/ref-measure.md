---
title: measure()
group: SDK reference
summary: Run the full crossing of functions × scenarios × repetitions and return an immutable Measurement.
---

```ts
import { measure } from "signal-sdk";

measure(
  functions: FunctionImplementation[],
  distribution: TaskDistribution,
  scenarios: Scenario[],
  options?: {
    domain?: Domain;                       // default RETURN_VALUES
    config?: MeasurementConfig;            // default new MeasurementConfig({ mode: "real" })
    validity?: ValidityPeriod | null;
    onTrial?: (trial: Trial) => void;
  },
): Promise<Measurement>
```

Runs the self-validation gate, verifies the book against its distribution, adds the domain's two controls, then executes every function on every scenario for `config.repetitions` repetitions with seeds shared across functions. Functions may be sync or async.

## Example

```ts
import { Function, FunctionImplementation, MeasurementConfig, measure } from "signal-sdk";
import { Mandate, generateBook, paymentsDomain } from "signal-sdk/domains/payments";

const { distribution, scenarios } = generateBook(48, { seed: 7, vendors: 16, variants: true });
const domain = paymentsDomain(new Mandate({ amountCap: 1500, allowedVendors, allowedAccounts,
  escalationConditions: ["duplicate", "bank_detail_change"] }));

const measurement = await measure(
  [new FunctionImplementation(new Function({ name: "reconcile", implementation: { revision: "9f3c1e2" } }), reconcile, "simulation")],
  distribution, scenarios,
  {
    domain,
    config: new MeasurementConfig({ mode: "simulation", repetitions: 3, seed: 7,
      severityAssumptions: { wrong_account: { distribution: "fixed", amount: 100, currency: "USD" } } }),
    onTrial: (trial) => console.log(trial.scenarioId, trial.grades.outcome.correct),
  },
);
```

## Parameters

| Name | Type | | |
|---|---|---|---|
| `functions` | `FunctionImplementation[]` | required | Distinct function identities to measure. Do not include controls. |
| `distribution` | `TaskDistribution` | required | The book's binding: dataset hash or generator parameters. |
| `scenarios` | `Scenario[]` | required | The book. Must reproduce or hash to the distribution. |
| `options.domain` | `Domain` | `RETURN_VALUES` | Environment, graders and controls. |
| `options.config` | `MeasurementConfig` | `{ mode: "real" }` | Repetitions, seed, bootstrap and loss settings, comparisons. |
| `options.validity` | `ValidityPeriod` | `null` | Period the measurement is valid for; the timestamp must fall inside it. |
| `options.onTrial` | `(trial) => void` | — | Called with each completed trial, for progress or streaming storage. |

## Returns

A promise of an immutable `Measurement`. Its `id` is the SHA-256 of its content; `controlIds` lists the controls; `validation` holds the gate's evidence.

## Throws

- `Error("Self-validation failed…")` when the gate fails: no function is executed.
- `ValidationError` when the book does not match its distribution, function kinds do not match `config.mode`, identities are not distinct, a predeclared comparison names an unknown function, controls are supplied, or the timestamp is outside `validity`.

## Notes

`mode: "real"` requires every implementation to be `kind: "real"` and to record model usage with a `providerVersion` matching a declared model; `mode: "simulation"` refuses real implementations. An exception inside the function keeps everything recorded so far and marks the trial with `error`.
