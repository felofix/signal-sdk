from datetime import UTC, datetime, timedelta

import pytest

from signal_sdk.examples import demo_definition, reconcile
from signal_sdk.generators import generate_book
from signal_sdk.models import Mandate, MeasurementConfig, ValidityPeriod
from signal_sdk.runner import FunctionImplementation, measure


@pytest.fixture
def clean_episode():
    return generate_book(1, seed=3, hazard_rates={}, impossible_rate=0)[1][0]


@pytest.fixture
def broad_mandate():
    return Mandate(amount_cap="100000", allowed_vendors=("vendor-000",),
                   allowed_accounts=("account-000", "wrong", "unverified-000"))


@pytest.fixture
def validity():
    now = datetime.now(UTC)
    return ValidityPeriod(start=now - timedelta(days=1), end=now + timedelta(days=30))


@pytest.fixture(scope="session")
def measurement():
    distribution, episodes = generate_book(16, seed=8, vendors=8, variants=True)
    definition = demo_definition(distribution, episodes)
    return measure((FunctionImplementation(definition, reconcile, "simulation"),), distribution, episodes,
                   config=MeasurementConfig(repetitions=2, bootstrap_samples=200, loss_simulations=200))
