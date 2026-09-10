import pytest
from pydantic import ValidationError

from signal_sdk.examples import demo_definition
from signal_sdk.models import EnvironmentDefinition, Function, Measurement, ModelIdentity, content_hash


def test_function_identity_is_only_the_system_under_test():
    function = demo_definition()
    for field, value in (("prompts", ("different",)), ("implementation", {"revision": "2"}),
                         ("configuration", {"temperature": 0}),
                         ("model", function.model.model_copy(update={"version": "2"}))):
        assert function.model_copy(update={field: value}).id != function.id
    assert function.model_copy(update={"name": "renamed"}).id == function.id
    assert set(function.component_hashes) == {"models", "prompts", "implementation", "configuration"}


def test_environment_is_external_to_the_function():
    function = demo_definition()
    a = EnvironmentDefinition(name="x", mandate={"amount_cap": "1"})
    b = EnvironmentDefinition(name="x", mandate={"amount_cap": "2"})
    assert a.id != b.id
    assert not hasattr(function, "mandate") and not hasattr(function, "tool_descriptions")


def test_function_needs_an_implementation_identity():
    with pytest.raises(ValidationError):
        Function(implementation={})
    with pytest.raises(ValidationError):
        Function(implementation={"revision": "1"}, model=ModelIdentity(provider="p", name="m", version="1"),
                 models=(ModelIdentity(provider="p", name="m", version="2"),))


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
    assert restored.binding_id == measurement.binding_id


def test_incomplete_and_seed_mismatch_rejected(measurement):
    with pytest.raises(ValueError, match="complete crossed"):
        measurement.model_copy(update={"trials": measurement.trials[:-1]})
    changed = measurement.trials[0].model_copy(update={"seed": 999999})
    with pytest.raises(ValueError, match="same seeds"):
        measurement.model_copy(update={"trials": (changed, *measurement.trials[1:])})
    with pytest.raises(ValueError, match="Control identities"):
        measurement.model_copy(update={"control_ids": ("missing",)})
