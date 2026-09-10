"""External enforcement for the optional constructed payment environment."""

from decimal import Decimal

from pydantic import Field

from signal_sdk.models import FrozenModel


class Mandate(FrozenModel):
    amount_cap: Decimal = Field(ge=0)
    allowed_vendors: tuple[str, ...] = ()
    allowed_accounts: tuple[str, ...] = ()
    escalation_conditions: tuple[str, ...] = ()
    currency: str = Field(default="USD", min_length=3, max_length=3)
