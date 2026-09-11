/**
 * LangChain bridge. Two plain shapes LangChain accepts without this file importing it:
 * tool descriptors for `tool(func, descriptor)` and a callback object for `callbacks: [...]`.
 */

import type { Json, JsonObject } from "./models.js";
import type { TraceRecorder } from "./tracing.js";

/** Any tools object that dispatches by tool name; PaymentTools and ReturnValueTools do. */
export interface CallableTools { call(name: string, args?: JsonObject): Json }

export interface LangChainToolDescriptor {
  name: string;
  description: string;
  schema: JsonObject;
  func: (args: JsonObject) => Promise<Json>;
}

const ANY_OBJECT: JsonObject = { type: "object", additionalProperties: true };

/** One descriptor per described tool. Calls go through `tools.call`, so tracing and mandate enforcement come for free. */
export function asLangChainTools(tools: CallableTools, descriptions: JsonObject, schemas: Record<string, JsonObject> = {}): LangChainToolDescriptor[] {
  return Object.entries(descriptions).map(([name, description]) => ({
    name, description: String(description), schema: schemas[name] ?? ANY_OBJECT,
    func: async (args: JsonObject) => tools.call(name, args ?? {}),
  }));
}

// ponytail: structural stand-ins for BaseMessage and LLMResult; only the fields we read.
interface MessageLike { _getType?: () => string; role?: string; content?: unknown }
interface ResultLike {
  llmOutput?: { tokenUsage?: { totalTokens?: number } };
  generations?: { text?: string; message?: MessageLike & { usage_metadata?: { total_tokens?: number } } }[][];
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : String((part as { text?: unknown })?.text ?? ""))).join("");
  return content == null ? "" : JSON.stringify(content);
}

const ROLES: Record<string, string> = { human: "user", ai: "assistant", system: "system", tool: "tool" };
function role(message: MessageLike): string {
  const kind = typeof message._getType === "function" ? message._getType() : message.role ?? "user";
  return ROLES[kind] ?? kind;
}

/** Records prompts, replies and token usage of every model call into the trace. Pass as `callbacks: [signalCallbacks(context.trace)]`. */
export function signalCallbacks(trace: TraceRecorder) {
  const started = new Map<string, number>();
  return {
    handleLLMStart(_llm: unknown, prompts: string[], runId = ""): void {
      for (const prompt of prompts) trace.appendMessage("user", prompt);
      started.set(runId, Date.now());
    },
    handleChatModelStart(_llm: unknown, messages: MessageLike[][], runId = ""): void {
      for (const message of messages.flat()) trace.appendMessage(role(message), text(message.content));
      started.set(runId, Date.now());
    },
    handleLLMEnd(output: ResultLike, runId = ""): void {
      const first = output.generations?.[0]?.[0];
      const tokens = output.llmOutput?.tokenUsage?.totalTokens ?? first?.message?.usage_metadata?.total_tokens ?? null;
      const startedAt = started.get(runId);
      started.delete(runId);
      trace.recordUsage({ tokens, cost: null, durationMs: startedAt === undefined ? 0 : Date.now() - startedAt, name: "langchain" });
      for (const generation of output.generations?.flat() ?? []) {
        trace.appendMessage(generation.message ? role(generation.message) : "assistant", generation.message ? text(generation.message.content) : (generation.text ?? ""));
      }
    },
  };
}
