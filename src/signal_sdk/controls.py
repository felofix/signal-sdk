"""Deliberately trivial controls that expose outcome and harm tradeoffs."""

from __future__ import annotations

from typing import Any


def always_pay(context: Any) -> None:
    tools = getattr(context, "tools", context)
    result = tools.lookup_documents()
    for document in result.get("documents", []):
        tools.pay(**{key: document.get(key, "") for key in
                     ("invoice_id", "vendor", "account", "amount", "currency")})


def always_escalate(context: Any) -> None:
    tools = getattr(context, "tools", context)
    tools.escalate(reason="Always-escalate control")
