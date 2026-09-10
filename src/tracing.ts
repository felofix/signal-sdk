/** Domain-neutral recording of what happened during one trial. */

import { performance } from "node:perf_hooks";
import { type Json, type JsonObject, Message, Step, Transcript, ValidationError, clone, plain } from "./models.js";

export interface UsageRecord { tokens: number | null; cost: number | null; durationMs?: number; name?: string; metadata?: JsonObject }

/** Every environment writes its steps and messages here; graders read the result. */
export class TraceRecorder {
  readonly steps: Step[] = [];
  readonly messages: Message[] = [];
  private readonly goals: string[] = [];

  /** Run a block under a goal; nested calls become sub-goals on every recorded step. */
  goal<T>(name: string, block: () => T): T {
    this.goals.push(name);
    try {
      const result = block();
      if (result instanceof Promise) {
        return result.finally(() => this.goals.pop()) as unknown as T;
      }
      this.goals.pop();
      return result;
    } catch (error) {
      this.goals.pop();
      throw error;
    }
  }

  private goalMetadata(): { goal: string | null; parentGoal: string | null } {
    return { goal: this.goals.at(-1) ?? null, parentGoal: this.goals.length > 1 ? this.goals[this.goals.length - 2] : null };
  }

  appendMessage(role: string, content: string): void {
    this.messages.push(new Message({ role, content, stepIndex: this.steps.length }));
  }

  /** Record actual provider usage, including unknown cost as null. */
  recordUsage({ tokens, cost, durationMs = 0, name = "model", metadata = {} }: UsageRecord): void {
    if ((tokens !== null && tokens < 0) || (cost !== null && cost < 0) || durationMs < 0) {
      throw new ValidationError("Usage values must be nonnegative");
    }
    this.steps.push(new Step({ index: this.steps.length, kind: "model", name, tokens, cost, durationMs, metadata, ...this.goalMetadata() }));
  }

  /** Record a runtime risk estimate before the first state-changing action. */
  recordSignal(probability: number, name = "risk_signal"): void {
    if (this.steps.some((s) => s.metadata.stateChanging)) {
      throw new ValidationError("Calibration signals must be recorded before actions");
    }
    if (!(probability >= 0 && probability <= 1)) throw new ValidationError("A risk signal must lie in [0, 1]");
    this.steps.push(new Step({ index: this.steps.length, kind: "signal", name, result: { riskSignal: probability }, cost: 0, ...this.goalMetadata() }));
  }

  /** Mark that earlier context was compacted: results before this point are no longer visible to the function. */
  recordCompaction(summary = ""): void {
    this.steps.push(new Step({ index: this.steps.length, kind: "compaction", name: "compaction", result: summary || null, cost: 0,
      metadata: { droppedBefore: this.steps.length }, ...this.goalMetadata() }));
  }

  /** Run a tool through the recorder; schema errors are recorded, never hidden. */
  recordTool<T>(name: string, args: JsonObject, call: () => T, options: { stateChanging?: boolean } = {}): T {
    const started = performance.now();
    const previous = this.steps.filter((s) => s.kind === "tool" && s.name === name).at(-1);
    const retry = Boolean(previous && previous.result && typeof previous.result === "object" && !Array.isArray(previous.result) && previous.result.toolFault);
    let schemaValid = true;
    let result: unknown;
    try {
      result = call();
    } catch (error) {
      if (error instanceof ValidationError || error instanceof TypeError || error instanceof RangeError) {
        schemaValid = false;
        result = { ok: false, schemaError: (error as Error).message };
      } else {
        throw error;
      }
    }
    this.steps.push(new Step({
      index: this.steps.length, kind: "tool", name, arguments: clone(args), result: plain(result) as Json,
      durationMs: performance.now() - started, tokens: 0, cost: 0, retry,
      metadata: { schemaValid, stateChanging: Boolean(options.stateChanging) }, ...this.goalMetadata(),
    }));
    return clone(result) as T;
  }

  transcript(): Transcript {
    return new Transcript({ steps: [...this.steps], messages: [...this.messages] });
  }
}
