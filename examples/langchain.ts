/**
 * A LangChain agent as the function under test. The environment's tools become LangChain
 * tools, so the mandate is enforced and every call is traced; a callback records model usage.
 *
 * Uses a scripted fake chat model so it runs offline. Swap in any tool-calling chat model.
 * Run with: npm run build && node dist/examples/langchain.js
 */

import { tool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type PaymentTools, generateBook, paymentsEnvironment } from "../src/environments/payments/index.js";
import { demoDefinition, demoMandate } from "../src/examples.js";
import { FunctionImplementation, MeasurementConfig, type TrialContext, measure } from "../src/index.js";
import { asLangChainTools, signalCallbacks } from "../src/langchain.js";

async function langchainAgent(context: TrialContext<PaymentTools>): Promise<unknown> {
  const tools = asLangChainTools(context.tools, TOOL_DESCRIPTIONS, TOOL_SCHEMAS).map((d) => tool(d.func, d));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, { invoke(input: object): Promise<unknown> }>;
  const model = new FakeListChatModel({ responses: ["Escalating: cannot verify vendor."] });
  const documents = await byName.lookup_documents.invoke({});
  const reply = await model.invoke(`Task: ${JSON.stringify(context.input)}\nDocuments: ${JSON.stringify(documents)}`, { callbacks: [signalCallbacks(context.trace)] });
  // ponytail: a scripted model always escalates; a real agent loop would follow the model's tool calls.
  await byName.escalate.invoke({ reason: String(reply.content) });
  return reply.content;
}

const { distribution, scenarios } = generateBook(12, { seed: 7, vendors: 4 });
const fn = demoDefinition("langchain-agent").with({ implementation: { module: "examples/langchain", callable: "langchainAgent", revision: "1" } });
const measurement = await measure([new FunctionImplementation(fn, langchainAgent, "simulation")], distribution, scenarios,
  { environment: paymentsEnvironment(demoMandate(scenarios)), config: new MeasurementConfig({ mode: "simulation", repetitions: 2, bootstrapSamples: 200, lossSimulations: 200 }) });
const trial = measurement.trials.find((t) => t.functionId === fn.id)!;
console.log(measurement.trials.length, "trials;", trial.transcript.steps.map((s) => `${s.kind}:${s.name}`).join(" -> "));
