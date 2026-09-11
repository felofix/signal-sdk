---
title: Function
group: SDK reference
summary: The identity of the system under test.
---

```ts
import { Function, ModelIdentity } from "@felofix/signal-sdk";

new Function({
  implementation: Record<string, Json>;             // required, non-empty
  model?: ModelIdentity | { provider, name, version };
  models?: ModelIdentity[];
  prompts?: string[];
  configuration?: Record<string, Json>;
  name?: string;                                    // "function"
})

new ModelIdentity({ provider: string; name: string; version: string })
```

A function is what you are measuring and nothing else. Tools, mandate, documents and the period are external and belong to the measurement.

## Example

```ts
const fn = new Function({
  name: "invoice-agent",
  model: new ModelIdentity({ provider: "anthropic", name: "claude-sonnet-5", version: "claude-sonnet-5-20260812" }),
  prompts: ["Reconcile the invoice; escalate when authorization is missing."],
  implementation: { repository: "org/agent", revision: "9f3c1e2" },
  configuration: { temperature: 0, maxSteps: 12 },
});
console.log(fn.id);                // sha256 over the four component hashes
console.log(fn.componentHashes);   // { models, prompts, implementation, configuration }

const variant = fn.with({ prompts: ["Reconcile the invoice."] });
console.assert(variant.id !== fn.id);
```

## Fields

| Name | Type | | |
|---|---|---|---|
| `implementation` | `Record<string, Json>` | required, non-empty | Revision, content hash or coordinates of the code that runs. |
| `model` | `ModelIdentity` | `null` | The single model. Mutually exclusive with `models`. |
| `models` | `ModelIdentity[]` | `[]` | Several models in one system. |
| `prompts` | `string[]` | `[]` | Exact prompts. |
| `configuration` | `Record<string, Json>` | `{}` | Anything else that changes behaviour: temperature, step limits, feature flags. |
| `name` | `string` | `"function"` | Display name. Not part of the identity. |

## Members

| Name | Meaning |
|---|---|
| `id` | SHA-256 of `componentHashes`. |
| `componentHashes` | One hash per component: `models`, `prompts`, `implementation`, `configuration`. |
| `modelIdentities` | `[model]` or `models`. |
| `with(update)` | A new validated `Function` with fields replaced. |
| `toJSON()` | Plain object including `id` and `componentHashes`. |

## Throws

`ValidationError` when `implementation` is empty, when both `model` and `models` are given, or when a `ModelIdentity.version` is a moving alias (`latest`, `default`, `auto`, `current`).

## Notes

Per-model prompts and configuration for systems of interacting models are not yet modelled; today `prompts` and `configuration` are flat.
