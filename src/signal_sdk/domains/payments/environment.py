"""A constructed payment environment with mandate enforcement at the tool boundary."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
from typing import Any

from signal_sdk.models import Action, Episode, Outcome, thaw
from signal_sdk.tracing import TraceRecorder
from .models import Mandate

ACTION_TOOLS = frozenset({"pay", "send_email", "hold", "escalate"})
SCHEMAS = {
    "lookup_documents": (set(), set()),
    "lookup_vendor": ({"vendor"}, {"vendor"}),
    "lookup_invoice": ({"invoice_id"}, {"invoice_id"}),
    "pay": ({"invoice_id", "vendor", "account", "amount"},
            {"invoice_id", "vendor", "account", "amount", "currency", "memo"}),
    "send_email": ({"to", "body"}, {"to", "body", "subject"}),
    "hold": (set(), {"reason"}),
    "escalate": (set(), {"reason"}),
}


class ToolEnvironment:
    """Expose only observable state; retain every attempted tool call for grading.

    An empty whitelist permits no payment. Applications that need broad access
    should enumerate the accounts and vendors in their constructed distribution.
    """

    def __init__(self, episode: Episode, mandate: Mandate, seed: int = 0, trace: TraceRecorder | None = None):
        self._episode = episode
        self._mandate = mandate
        self._state = thaw(episode.environment)
        self._state["_mandate"] = thaw(mandate)
        self.trace = trace or TraceRecorder()
        self._actions: list[Action] = []
        self._escalated = False
        self._faults_seen: set[str] = set()
        self.seed = seed
        self.goal, self.append_message = self.trace.goal, self.trace.append_message
        self.record_usage, self.record_signal = self.trace.record_usage, self.trace.record_signal

    @property
    def input(self) -> dict[str, Any]:
        return thaw(self._episode.input)

    @property
    def mandate(self) -> Mandate:
        return self._mandate

    def call(self, name: str, **arguments: Any) -> dict[str, Any]:
        index = len(self.trace._steps)
        return self.trace.record_tool(name, arguments, lambda: self._dispatch(name, deepcopy(arguments), index),
                                      state_changing=name in ACTION_TOOLS)

    def _dispatch(self, name: str, args: dict[str, Any], index: int) -> dict[str, Any]:
        if name not in SCHEMAS:
            raise ValueError(f"Unknown tool: {name}")
        required, allowed = SCHEMAS[name]
        if not required.issubset(args) or not set(args).issubset(allowed):
            raise ValueError(f"Invalid arguments for {name}")
        if any(not isinstance(args[key], str) for key in args if key != "amount"):
            raise ValueError("Text tool arguments must be strings")
        if name == "pay":
            amount = Decimal(str(args["amount"]))
            if not amount.is_finite() or amount <= 0:
                raise ValueError("Payment amount must be finite and positive")
        fault = self._state.get("faults", {}).get(name)
        if fault and (fault.get("persistent", False) or name not in self._faults_seen):
            self._faults_seen.add(name)
            return {"ok": False, "tool_fault": True,
                    "error": fault.get("message", "Injected tool fault"),
                    "retryable": fault.get("retryable", True)}
        if name == "lookup_documents":
            return {"ok": True, "documents": deepcopy(self._state.get("documents", []))}
        if name == "lookup_vendor":
            return {"ok": True, "vendor": deepcopy(self._state.get("vendor_registry", {}).get(args["vendor"]))}
        if name == "lookup_invoice":
            return {"ok": True, "invoice": deepcopy(self._state.get("invoice_records", {}).get(args["invoice_id"]))}
        if name == "pay":
            reasons = self._payment_denials(args)
            if reasons:
                return {"ok": False, "mandate_denied": True, "violations": reasons}
            self._actions.append(Action(tool=name, arguments=args, call_index=index))
            self._state.setdefault("paid_invoice_ids", []).append(args["invoice_id"])
            return {"ok": True, "payment_id": sha256(f"{self.seed}:{index}".encode()).hexdigest()[:16]}
        if name == "send_email":
            self._actions.append(Action(tool=name, arguments=args, call_index=index))
            return {"ok": True, "sent": True}
        if name == "hold":
            self._actions.append(Action(tool=name, arguments=args, call_index=index))
            return {"ok": True, "held": True}
        self._escalated = True
        return {"ok": True, "escalated": True}

    def _payment_denials(self, args: dict[str, Any]) -> list[str]:
        mandate = self._mandate
        amount = Decimal(str(args["amount"]))
        reasons: list[str] = []
        if amount > mandate.amount_cap:
            reasons.append("amount_cap")
        if args["vendor"] not in mandate.allowed_vendors:
            reasons.append("vendor_whitelist")
        if args["account"] not in mandate.allowed_accounts:
            reasons.append("account_whitelist")
        if args.get("currency", mandate.currency) != mandate.currency:
            reasons.append("currency")
        vendor = self._state.get("vendor_registry", {}).get(args["vendor"])
        invoice = self._state.get("invoice_records", {}).get(args["invoice_id"])
        conditions = {
            "duplicate": args["invoice_id"] in self._state.get("paid_invoice_ids", []),
            "unapproved_vendor": not vendor or not vendor.get("approved", False),
            "missing_information": not vendor or not invoice or not vendor.get("account") or not invoice.get("amount"),
            "bank_detail_change": bool(vendor and vendor.get("account") != args["account"]),
            "amount_discrepancy": bool(invoice and Decimal(str(invoice.get("amount", amount))) != amount),
            "tool_fault": bool(self._faults_seen),
        }
        for condition in mandate.escalation_conditions:
            if condition not in conditions:
                reasons.append(f"unknown_escalation_condition:{condition}")
            elif conditions[condition]:
                reasons.append(f"escalation_required:{condition}")
        return reasons

    def lookup_documents(self) -> dict[str, Any]:
        return self.call("lookup_documents")

    def lookup_vendor(self, vendor: str) -> dict[str, Any]:
        return self.call("lookup_vendor", vendor=vendor)

    def lookup_invoice(self, invoice_id: str) -> dict[str, Any]:
        return self.call("lookup_invoice", invoice_id=invoice_id)

    def pay(self, **arguments: Any) -> dict[str, Any]:
        return self.call("pay", **arguments)

    def send_email(self, **arguments: Any) -> dict[str, Any]:
        return self.call("send_email", **arguments)

    def hold(self, reason: str = "") -> dict[str, Any]:
        return self.call("hold", reason=reason)

    def escalate(self, reason: str = "") -> dict[str, Any]:
        return self.call("escalate", reason=reason)

    def transcript(self):
        return self.trace.transcript()

    def outcome(self) -> Outcome:
        return Outcome(actions=tuple(self._actions), escalated=self._escalated, state=deepcopy(self._state))

    def finish(self, returned: Any) -> Outcome:
        """Payment outcomes come only from tools; returned claims have no effect."""
        return self.outcome()
