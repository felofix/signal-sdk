/** External enforcement for the optional constructed payment environment. */

import { type JsonObject, check, deepFreeze } from "../../models.js";

export interface MandateInit {
  amountCap: number | string; allowedVendors?: readonly string[]; allowedAccounts?: readonly string[]; escalationConditions?: readonly string[]; currency?: string;
}

export class Mandate {
  readonly amountCap: number;
  readonly allowedVendors: readonly string[];
  readonly allowedAccounts: readonly string[];
  readonly escalationConditions: readonly string[];
  readonly currency: string;

  constructor(init: MandateInit) {
    this.amountCap = Number(init.amountCap);
    check(Number.isFinite(this.amountCap) && this.amountCap >= 0, "amountCap must be a nonnegative finite number");
    this.allowedVendors = Object.freeze([...(init.allowedVendors ?? [])]);
    this.allowedAccounts = Object.freeze([...(init.allowedAccounts ?? [])]);
    this.escalationConditions = Object.freeze([...(init.escalationConditions ?? [])]);
    this.currency = init.currency ?? "USD";
    check(this.currency.length === 3, "currency must be a three-letter code");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { amountCap: this.amountCap, allowedVendors: [...this.allowedVendors], allowedAccounts: [...this.allowedAccounts],
      escalationConditions: [...this.escalationConditions], currency: this.currency };
  }
  toJSON(): JsonObject { return this.toPlain(); }
  with(update: Partial<MandateInit>): Mandate { return new Mandate({ ...(this.toPlain() as unknown as MandateInit), ...update }); }
}
