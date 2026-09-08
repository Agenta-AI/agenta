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


@pytest.mark.parametrize("key", sorted(RESOLVABLE_AGENT_REFERENCE_KEYS))
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
