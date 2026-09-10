"""Transparent simulation functions: a generic return-value task and the payment domain."""

from decimal import Decimal

from .domain import TrialContext
from .domains.payments import HARM_CLASSES, Mandate, generate_book, payments_domain
from .models import Trajectory, Function, Label, MeasurementConfig, ModelIdentity
from .runner import FunctionImplementation, dataset_distribution, measure


def reconcile(context: TrialContext) -> str:
    """A deterministic reference policy using only observable input and tools."""
    tools = context.tools
    with tools.goal("Reconcile invoice"):
        with tools.goal("Read documents"):
            response = tools.lookup_documents()
            if response.get("tool_fault"):
                response = tools.lookup_documents()
            if not response.get("ok"):
                tools.record_signal(1.)
                tools.escalate(reason="Document store unavailable")
                return "Escalated"
        document = next((d for d in response.get("documents", ()) if d.get("document_type") != "purchase_order"), None)
        if not document:
            tools.record_signal(1.)
            tools.escalate(reason="Invoice missing")
            return "Escalated"
        with tools.goal("Verify authorization"):
            vendor = tools.lookup_vendor(document["vendor"]).get("vendor")
            invoice = tools.lookup_invoice(document["invoice_id"]).get("invoice")
            suspicious = (not vendor or not invoice or not vendor.get("approved")
                          or not document.get("account") or not vendor.get("account")
                          or document.get("account") != vendor.get("account")
                          or Decimal(str(document["amount"])) != Decimal(str(invoice["amount"])))
        tools.record_signal(.9 if suspicious else .1)
        with tools.goal("Resolve invoice"):
            if suspicious:
                tools.escalate(reason="Authorization or information mismatch")
                return "Escalated"
            result = tools.pay(**{key: document[key] for key in
                                  ("invoice_id", "vendor", "account", "amount", "currency")})
            if not result.get("ok"):
                tools.escalate(reason="Mandate stopped payment")
                return "Escalated"
    return "Paid"


def demo_definition(name: str = "reconcile") -> Function:
    return Function(name=name, model=ModelIdentity(provider="simulation", name=name, version="1"),
                    prompts=("Verify the invoice against authoritative tool results; escalate inconsistencies.",),
                    implementation={"module": "signal_sdk.examples", "callable": "reconcile", "revision": "1"})


def demo_mandate(trajectories: tuple[Trajectory, ...]) -> Mandate:
    vendors = sorted({v for e in trajectories for v in e.environment.get("vendor_registry", {})})
    accounts = sorted({v["account"] for e in trajectories for v in e.environment.get("vendor_registry", {}).values() if v.get("account")})
    return Mandate(amount_cap="1500", allowed_vendors=tuple(vendors), allowed_accounts=tuple(accounts),
                   escalation_conditions=("duplicate", "unapproved_vendor", "missing_information",
                                          "bank_detail_change", "amount_discrepancy"))


def demo(count: int = 48, seed: int = 7, repetitions: int = 3, variants: bool = True):
    distribution, trajectories = generate_book(count, seed=seed, vendors=min(16, count), variants=variants)
    config = MeasurementConfig(repetitions=repetitions, seed=seed, mode="simulation",
                               bootstrap_samples=500, loss_simulations=1000,
                               severity_assumptions={h: {"distribution": "fixed", "amount": 100, "currency": "USD"} for h in HARM_CLASSES})
    return measure((FunctionImplementation(demo_definition(), reconcile, kind="simulation"),),
                   distribution, trajectories, domain=payments_domain(demo_mandate(trajectories)), config=config)


def arithmetic_book(count: int = 24, seed: int = 0):
    """A generic book for the default domain: answer a sum, or escalate when an operand is missing."""
    import random

    rng = random.Random(seed)
    trajectories = []
    for index in range(count):
        a, b = rng.randint(1, 99), rng.randint(1, 99)
        missing = index % 6 == 5
        construction = {"index": index, "missing_operand": missing, "operands": 2}
        trajectories.append(Trajectory(id=f"sum-{seed}-{index:04d}", input={"task": f"What is {a} + {'?' if missing else b}?"},
                                construction=construction, label=Label.IMPOSSIBLE if missing else Label.EASY,
                                ground_truth={"value": None if missing else a + b, "escalated": missing},
                                cluster=f"batch-{index // 4:02d}"))
    trajectories = tuple(trajectories)
    distribution = dataset_distribution("Arithmetic book", trajectories, top_cluster="batch",
                                        label_rule="impossible if an operand is missing; otherwise easy")
    return distribution, trajectories


def add(context: TrialContext) -> int | None:
    task = context.input["task"]
    if "+ ?" in task:
        context.tools.escalate(reason="Missing operand")
        return None
    a, b = task.removeprefix("What is ").rstrip("?").split(" + ")
    return int(a) + int(b)


def arithmetic_demo(count: int = 24, seed: int = 0, repetitions: int = 2):
    distribution, trajectories = arithmetic_book(count, seed)
    function = Function(name="add", implementation={"module": "signal_sdk.examples", "callable": "add", "revision": "1"})
    return measure((FunctionImplementation(function, add, kind="simulation"),), distribution, trajectories,
                   config=MeasurementConfig(repetitions=repetitions, seed=seed, mode="simulation",
                                            bootstrap_samples=300, loss_simulations=300))
