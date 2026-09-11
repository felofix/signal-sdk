import assert from "node:assert/strict";
import { test } from "node:test";
import { asLangChainTools, signalCallbacks } from "../src/langchain.js";
import { TOOL_DESCRIPTIONS, TOOL_SCHEMAS, paymentsEnvironment } from "../src/environments/payments/index.js";
import { TraceRecorder } from "../src/tracing.js";
import { cleanScenario, broadMandate } from "./fixtures.js";

test("LangChain tool descriptors call the environment's tools through the trace", async () => {
  const scenario = cleanScenario();
  const tools = paymentsEnvironment(broadMandate()).makeTools(scenario, 0, new TraceRecorder());
  const descriptors = asLangChainTools(tools, TOOL_DESCRIPTIONS, TOOL_SCHEMAS);
  assert.deepEqual(descriptors.map((d) => d.name), Object.keys(TOOL_DESCRIPTIONS));
  assert.deepEqual(descriptors.find((d) => d.name === "pay")!.schema.required, ["invoice_id", "vendor", "account", "amount"]);
  const result = await descriptors.find((d) => d.name === "lookup_documents")!.func({});
  assert.ok(Array.isArray((result as { documents: unknown }).documents));
  assert.equal(tools.transcript().steps[0].name, "lookup_documents");
});

test("callbacks record messages and usage from chat model events", () => {
  const trace = new TraceRecorder();
  const callbacks = signalCallbacks(trace);
  callbacks.handleChatModelStart({}, [[{ _getType: () => "human", content: "Pay it" }]], "run-1");
  callbacks.handleLLMEnd({ generations: [[{ message: { _getType: () => "ai", content: [{ type: "text", text: "Done" }], usage_metadata: { total_tokens: 42 } } }]] }, "run-1");
  assert.deepEqual(trace.messages.map((m) => [m.role, m.content]), [["user", "Pay it"], ["assistant", "Done"]]);
  assert.equal(trace.steps[0].kind, "model");
  assert.equal(trace.steps[0].tokens, 42);
});
