from datetime import timedelta

import pytest
from pydantic import ValidationError

from signal_sdk.examples import demo_definition
from signal_sdk.generators import generate_book
from signal_sdk.models import Measurement, ModelIdentity, content_hash


def test_component_identity_and_period_binding():
    distribution, episodes = generate_book(2)
    function = demo_definition(distribution, episodes)
    for field, value in (("prompts", ("different",)), ("tool_descriptions", {"different": "tool"}),
                         ("toolset", {"version": "2"}), ("distribution_id", "different"),
                         ("model", function.model.model_copy(update={"version": "2"})),
                         ("mandate", function.mandate.model_copy(update={"amount_cap": "1"}))):
        assert function.model_copy(update={field: value}).id != function.id
    changed = function.model_copy(update={"validity": function.validity.model_copy(update={"end": function.validity.end + timedelta(days=1)})})
    assert changed.id == function.id
    assert changed.binding_id != function.binding_id
    assert len(function.component_hashes) == 6


def test_nested_immutable(clean_episode):
    with pytest.raises(TypeError):
        clean_episode.environment["documents"][0]["amount"] = "1"
    with pytest.raises(ValidationError):
        clean_episode.id = "other"
    changed = clean_episode.model_copy(update={"input": {"task": ["x"]}})
    with pytest.raises(TypeError):
        changed.input["task"][0] = "y"


@pytest.mark.parametrize("version", ["latest", "default", "auto", "current", ""])
def test_pinned_versions(version):
    with pytest.raises(ValueError):
        ModelIdentity(provider="provider", name="model", version=version)


def test_snapshot_round_trip(measurement):
    restored = Measurement.model_validate_json(measurement.model_dump_json())
    assert restored.id == measurement.id
    assert content_hash(restored) == content_hash(measurement)


def test_incomplete_and_seed_mismatch_rejected(measurement):
    with pytest.raises(ValueError, match="complete crossed"):
        measurement.model_copy(update={"trials": measurement.trials[:-1]})
    changed = measurement.trials[0].model_copy(update={"seed": 999999})
    with pytest.raises(ValueError, match="same seeds"):
        measurement.model_copy(update={"trials": (changed, *measurement.trials[1:])})
