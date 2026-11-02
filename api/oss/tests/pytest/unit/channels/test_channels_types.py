from uuid import uuid4

import pytest

from oss.src.core.channels.dtos import ChannelPolicyLevel
from oss.src.core.channels.types import (
    ChannelAgentNotFound,
    ChannelAgentNotGranted,
    ChannelConnectionNotFound,
    ChannelLocatorIncomplete,
    ChannelNotSupported,
    ChannelPolicyDenied,
    ChannelSignatureInvalid,
    ChannelSpaceNotFound,
    ChannelThreadNotFound,
    ChannelsError,
)


def _exceptions():
    agent_id, space_id = uuid4(), uuid4()

    return [
        ChannelsError(),
        ChannelNotSupported(channel="slack"),
        ChannelSpaceNotFound(space_id=space_id),
        ChannelLocatorIncomplete(channel="slack", grain="thread", missing="thread_ts"),
        ChannelAgentNotFound(agent_id=agent_id),
        ChannelAgentNotGranted(agent_id=agent_id, space_id=space_id),
        ChannelThreadNotFound(thread_id=uuid4()),
        ChannelSignatureInvalid(channel="slack"),
        ChannelConnectionNotFound(connection_id=uuid4()),
        ChannelPolicyDenied(field="backfill", level=ChannelPolicyLevel.AGENT),
    ]


@pytest.mark.parametrize("error", _exceptions(), ids=lambda e: type(e).__name__)
def test_message_is_set_and_non_empty(error):
    # the router reads .message when building an HTTPException detail
    assert isinstance(error.message, str)
    assert error.message.strip()
    assert str(error) == error.message


@pytest.mark.parametrize("error", _exceptions(), ids=lambda e: type(e).__name__)
def test_every_exception_is_catchable_as_the_domain_base(error):
    assert isinstance(error, ChannelsError)


def test_signature_invalid_leaks_nothing_but_the_channel():
    error = ChannelSignatureInvalid(channel="slack")

    assert error.channel == "slack"
    assert set(vars(error)) == {"message", "channel"}


def test_identifying_attributes_are_carried():
    agent_id, space_id = uuid4(), uuid4()

    assert ChannelNotSupported(channel="telegram").channel == "telegram"
    assert (
        ChannelAgentNotGranted(agent_id=agent_id, space_id=space_id).space_id
        == space_id
    )
    assert (
        ChannelPolicyDenied(field="forwardfill", level=ChannelPolicyLevel.SPACE).level
        is ChannelPolicyLevel.SPACE
    )

    incomplete = ChannelLocatorIncomplete(
        channel="slack", grain="thread", missing="thread_ts"
    )
    assert (incomplete.grain, incomplete.missing) == ("thread", "thread_ts")


def test_space_not_found_accepts_either_identifier():
    external_key = uuid4()

    assert str(external_key) in ChannelSpaceNotFound(external_key=external_key).message
