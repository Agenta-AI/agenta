"""A channel agent's bound reference must use a key the workflows service
resolves. The settings form once wrote `main`, which hydrated nothing, so no
agent registered through the UI ever ran (F73). Refusing the key at write time
turns a silent first-turn failure into a 422 the caller sees."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.channels.dtos import (
    RESOLVABLE_AGENT_REFERENCE_KEYS,
    ChannelAgentData,
)


# The contract, spelled out: the families the workflows service resolves.
RESOLVABLE = [
    "workflow",
    "workflow_variant",
    "workflow_revision",
    "application",
    "application_variant",
    "application_revision",
]


def test_the_resolvable_families_are_exactly_these():
    assert set(RESOLVABLE_AGENT_REFERENCE_KEYS) == set(RESOLVABLE)


@pytest.mark.parametrize("key", RESOLVABLE)
def test_every_resolvable_family_key_is_accepted(key):
    data = ChannelAgentData(references={key: {"id": uuid4()}})

    assert set(data.references) == {key}


@pytest.mark.parametrize("key", ["main", "agent", "workflow_variants", ""])
def test_a_key_the_runtime_cannot_resolve_is_refused_with_the_allowed_list(key):
    with pytest.raises(ValidationError) as caught:
        ChannelAgentData(references={key: {"id": uuid4()}})

    message = str(caught.value)
    assert "workflow_variant" in message
    assert repr(key) in message


def test_an_empty_reference_map_is_refused():
    """An agent with nothing to run would fail on its first turn; refuse it here."""
    with pytest.raises(ValidationError) as caught:
        ChannelAgentData(references={})

    assert "must name the workflow" in str(caught.value)


def test_references_from_two_families_are_refused():
    """The runtime runs exactly one family per turn; a mixed binding would save
    and then fail on its first turn."""
    with pytest.raises(ValidationError) as caught:
        ChannelAgentData(
            references={
                "workflow_variant": {"id": uuid4()},
                "application_revision": {"id": uuid4()},
            }
        )

    assert "one family" in str(caught.value)


def test_references_within_one_family_are_accepted_together():
    data = ChannelAgentData(
        references={
            "workflow": {"id": uuid4()},
            "workflow_variant": {"id": uuid4()},
            "workflow_revision": {"id": uuid4()},
        }
    )

    assert set(data.references) == {"workflow", "workflow_variant", "workflow_revision"}
