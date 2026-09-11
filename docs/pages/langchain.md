---
title: LangChain
group: Guides
summary: Run a LangChain agent as the function under test, with Signal's tools and tracing.
---

`@felofix/signal-sdk/langchain` bridges in both directions without importing LangChain: the environment's tools become LangChain tool descriptors, and a callback object records every model call into the trace. `@langchain/core` is your dependency, not Signal's.

```ts
import { tool } from "@langchain/core/tools";
import { asLangChainTools, signalCallbacks } from "@felofix/signal-sdk/langchain";
import { TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type PaymentTools } from "@felofix/signal-sdk/environments/payments";

async function agent(context: TrialContext<PaymentTools>) {
  const tools = asLangChainTools(context.tools, TOOL_DESCRIPTIONS, TOOL_SCHEMAS).map((d) => tool(d.func, d));
  const model = new ChatAnthropic({ model: "claude-sonnet-5" }).bindTools(tools);
  const callbacks = [signalCallbacks(context.trace)];
  // ... your agent loop: model.invoke(messages, { callbacks }); tool.invoke(args) for each tool call
}
```

## asLangChainTools(tools, descriptions, schemas?)

One descriptor `{ name, description, schema, func }` per entry in `descriptions` (normally `definition.toolDescriptions`). `func` calls `tools.call(name, args)`, so the mandate is enforced and the step is traced exactly as if the function had called the tool directly. `schemas` are JSON Schema objects; the payments environment exports `TOOL_SCHEMAS`. Any tools object with `call(name, args)` works; `PaymentTools` and `ReturnValueTools` both have it.

## signalCallbacks(trace)

A plain object with `handleLLMStart`, `handleChatModelStart` and `handleLLMEnd`. Prompts and replies land in `trace.messages`; each completion records a `model` step with `tokens` read from `llmOutput.tokenUsage.totalTokens` or the message's `usage_metadata`, `cost: null`, and wall-clock `durationMs`. Pass it as `callbacks: [signalCallbacks(context.trace)]` on `invoke`.

## What is measured

The agent's tool calls, since they go through the environment. Mechanisms like `mandate_attempt` and `injection_followed` read the same transcript as any other function. Model calls appear as usage only; nothing is inferred from model text.

`examples/langchain.ts` runs offline with a scripted fake model.
