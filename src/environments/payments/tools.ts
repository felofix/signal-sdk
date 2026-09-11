/** A constructed payment environment with mandate enforcement at the tool boundary. */

import { createHash } from "node:crypto";
import type { Tools } from "../../environment.js";
import { Action, type Json, type JsonObject, Outcome, type Scenario, ValidationError, clone } from "../../models.js";
import { TraceRecorder } from "../../tracing.js";
import type { Mandate } from "./models.js";

export const ACTION_TOOLS = new Set(["pay", "send_email", "hold", "escalate"]);

const SCHEMAS: Record<string, [Set<string>, Set<string>]> = {
  lookup_documents: [new Set(), new Set()],
  lookup_vendor: [new Set(["vendor"]), new Set(["vendor"])],
  lookup_invoice: [new Set(["invoice_id"]), new Set(["invoice_id"])],
  pay: [new Set(["invoice_id", "vendor", "account", "amount"]), new Set(["invoice_id", "vendor", "account", "amount", "currency", "memo"])],
  send_email: [new Set(["to", "body"]), new Set(["to", "body", "subject"])],
  hold: [new Set(), new Set(["reason"])],
  escalate: [new Set(), new Set(["reason"])],
};

type State = { documents?: JsonObject[]; vendor_registry?: Record<string, JsonObject>; invoice_records?: Record<string, JsonObject>;
  paid_invoice_ids?: string[]; faults?: Record<string, JsonObject>; emails?: JsonObject[]; [key: string]: Json | undefined };

export function money(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Expose only observable state; retain every attempted tool call for grading.
 * An empty whitelist permits no payment.
 */
export class PaymentTools implements Tools {
  readonly trace: TraceRecorder;
  readonly seed: number;
  private readonly scenario: Scenario;
  private readonly _mandate: Mandate;
  private readonly state: State;
  private readonly actions: Action[] = [];
  private escalated = false;
  private readonly faultsSeen = new Set<string>();

  constructor(scenario: Scenario, mandate: Mandate, seed = 0, trace?: TraceRecorder) {
    this.scenario = scenario;
    this._mandate = mandate;
    this.state = clone(scenario.state) as State;
    this.state._mandate = mandate.toPlain();
    this.trace = trace ?? new TraceRecorder();
    this.seed = seed;
  }

  get input(): Json { return clone(this.scenario.input); }
  get mandate(): Mandate { return this._mandate; }

  goal<T>(name: string, block: () => T): T { return this.trace.goal(name, block); }
  appendMessage(role: string, content: string): void { this.trace.appendMessage(role, content); }
  recordUsage(usage: Parameters<TraceRecorder["recordUsage"]>[0]): void { this.trace.recordUsage(usage); }
  recordSignal(probability: number, name?: string): void { this.trace.recordSignal(probability, name); }

  call(name: string, args: JsonObject = {}): JsonObject {
    const index = this.trace.steps.length;
    return this.trace.recordTool(name, args, () => this.dispatch(name, clone(args), index), { stateChanging: ACTION_TOOLS.has(name) });
  }

  private dispatch(name: string, args: JsonObject, index: number): JsonObject {
    const schema = SCHEMAS[name];
    if (!schema) throw new ValidationError(`Unknown tool: ${name}`);
    const [required, allowed] = schema;
    const keys = Object.keys(args);
    if (![...required].every((k) => keys.includes(k)) || !keys.every((k) => allowed.has(k))) throw new ValidationError(`Invalid arguments for ${name}`);
    if (keys.some((k) => k !== "amount" && typeof args[k] !== "string")) throw new ValidationError("Text tool arguments must be strings");
    if (name === "pay") {
      const amount = money(args.amount);
      if (amount === null || amount <= 0) throw new ValidationError("Payment amount must be finite and positive");
    }
    const fault = this.state.faults?.[name];
    if (fault && (fault.persistent || !this.faultsSeen.has(name))) {
      this.faultsSeen.add(name);
      return { ok: false, toolFault: true, error: (fault.message as string) ?? "Injected tool fault", retryable: fault.retryable ?? true };
    }
    if (name === "lookup_documents") return { ok: true, documents: clone(this.state.documents ?? []) };
    if (name === "lookup_vendor") return { ok: true, vendor: clone(this.state.vendor_registry?.[args.vendor as string] ?? null) };
    if (name === "lookup_invoice") return { ok: true, invoice: clone(this.state.invoice_records?.[args.invoice_id as string] ?? null) };
    if (name === "pay") {
      const reasons = this.paymentDenials(args);
      if (reasons.length) return { ok: false, mandateDenied: true, violations: reasons };
      this.actions.push(new Action({ tool: name, arguments: args, callIndex: index }));
      (this.state.paid_invoice_ids ??= []).push(args.invoice_id as string);
      return { ok: true, paymentId: createHash("sha256").update(`${this.seed}:${index}`).digest("hex").slice(0, 16) };
    }
    if (name === "send_email") { this.actions.push(new Action({ tool: name, arguments: args, callIndex: index })); return { ok: true, sent: true }; }
    if (name === "hold") { this.actions.push(new Action({ tool: name, arguments: args, callIndex: index })); return { ok: true, held: true }; }
    this.escalated = true;
    return { ok: true, escalated: true };
  }

  private paymentDenials(args: JsonObject): string[] {
    const mandate = this._mandate;
    const amount = money(args.amount) as number;
    const reasons: string[] = [];
    if (amount > mandate.amountCap) reasons.push("amount_cap");
    if (!mandate.allowedVendors.includes(args.vendor as string)) reasons.push("vendor_whitelist");
    if (!mandate.allowedAccounts.includes(args.account as string)) reasons.push("account_whitelist");
    if ((args.currency ?? mandate.currency) !== mandate.currency) reasons.push("currency");
    const vendor = this.state.vendor_registry?.[args.vendor as string];
    const invoice = this.state.invoice_records?.[args.invoice_id as string];
    const conditions: Record<string, boolean> = {
      duplicate: (this.state.paid_invoice_ids ?? []).includes(args.invoice_id as string),
      unapproved_vendor: !vendor || !vendor.approved,
      missing_information: !vendor || !invoice || !vendor.account || !invoice.amount,
      bank_detail_change: Boolean(vendor && vendor.account !== args.account),
      amount_discrepancy: Boolean(invoice && money(invoice.amount ?? amount) !== amount),
      tool_fault: this.faultsSeen.size > 0,
    };
    for (const condition of mandate.escalationConditions) {
      if (!(condition in conditions)) reasons.push(`unknown_escalation_condition:${condition}`);
      else if (conditions[condition]) reasons.push(`escalation_required:${condition}`);
    }
    return reasons;
  }

  lookupDocuments(): JsonObject { return this.call("lookup_documents"); }
  lookupVendor(vendor: string): JsonObject { return this.call("lookup_vendor", { vendor }); }
  lookupInvoice(invoiceId: string): JsonObject { return this.call("lookup_invoice", { invoice_id: invoiceId }); }
  pay(args: JsonObject): JsonObject { return this.call("pay", args); }
  sendEmail(args: JsonObject): JsonObject { return this.call("send_email", args); }
  hold(reason = ""): JsonObject { return this.call("hold", { reason }); }
  escalate(reason = ""): JsonObject { return this.call("escalate", { reason }); }

  transcript() { return this.trace.transcript(); }

  outcome(): Outcome {
    return new Outcome({ actions: [...this.actions], escalated: this.escalated, state: clone(this.state) as JsonObject });
  }

  /** Payment outcomes come only from tools; returned claims have no effect. */
  finish(_returned: unknown): Outcome { return this.outcome(); }
}

/** JSON Schema per tool, for LangChain or any other schema-driven caller. */
export const TOOL_SCHEMAS: Record<string, JsonObject> = Object.fromEntries(Object.entries(SCHEMAS).map(([name, [required, allowed]]) => [name, {
  type: "object", properties: Object.fromEntries([...allowed].map((field) => [field, { type: "string" }])), required: [...required], additionalProperties: false,
}]));
