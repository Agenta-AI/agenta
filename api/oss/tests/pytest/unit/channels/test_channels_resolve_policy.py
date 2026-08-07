"""resolve_policy: pure, no DB — every conflict case from specs-wp1.md."""

import pytest

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelPolicy,
    ChannelPolicyLevel,
    ChannelSessionScope,
    ChannelTriggerKind,
)
from oss.src.core.channels.utils import resolve_policy


SLACK = {
    "channel": "slack",
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {"supported": True},
        "forwardfill": {"supported": True},
    },
}


@pytest.fixture
def capabilities() -> ChannelCapabilities:
    return ChannelCapabilities(**SLACK)


@pytest.fixture
def channel_defaults(capabilities) -> ChannelPolicy:
    return ChannelPolicy(
        triggers={ChannelTriggerKind.MENTION},
        session_scope=capabilities.conversation.default,
        backfill=True,
        forwardfill=True,
    )


def test_a_stated_false_wins_over_a_stated_true(capabilities, channel_defaults):
    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(backfill=False),
        ChannelPolicy(backfill=True),
        None,
    )

    assert result.backfill is False


def test_triggers_intersect_across_levels(capabilities, channel_defaults):
    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(
            triggers={ChannelTriggerKind.MENTION, ChannelTriggerKind.COMMAND}
        ),
        ChannelPolicy(triggers={ChannelTriggerKind.MENTION}),
        None,
    )

    assert result.triggers == {ChannelTriggerKind.MENTION}


def test_session_scope_narrowest_stated_wins(capabilities, channel_defaults):
    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(session_scope=ChannelSessionScope.THREAD),
        None,
        ChannelPolicy(session_scope=ChannelSessionScope.MESSAGE),
    )

    assert result.session_scope == ChannelSessionScope.MESSAGE


def test_unstated_everywhere_falls_through_to_channel_default(
    capabilities, channel_defaults
):
    result = resolve_policy(capabilities, channel_defaults, None, None, None)

    assert result.backfill == channel_defaults.backfill
    assert result.decided_by["backfill"] == ChannelPolicyLevel.CHANNEL
    assert result.session_scope == channel_defaults.session_scope
    assert result.decided_by["session_scope"] == ChannelPolicyLevel.CHANNEL
    assert result.triggers == channel_defaults.triggers
    assert result.decided_by["triggers"] == ChannelPolicyLevel.CHANNEL
    assert result.forwardfill == channel_defaults.forwardfill
    assert result.decided_by["forwardfill"] == ChannelPolicyLevel.CHANNEL


def test_capability_denial_overrides_every_permissive_level(channel_defaults):
    denied = ChannelCapabilities(
        **{**SLACK, "fill": {"backfill": {"supported": False}}}
    )

    result = resolve_policy(
        denied,
        channel_defaults,
        ChannelPolicy(backfill=True),
        ChannelPolicy(backfill=True),
        ChannelPolicy(backfill=True),
    )

    assert result.backfill is False
    assert result.decided_by["backfill"] == ChannelPolicyLevel.CAPABILITY


def test_decided_by_names_the_correct_level_per_field(capabilities, channel_defaults):
    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(backfill=False),  # agent
        ChannelPolicy(session_scope=ChannelSessionScope.MESSAGE),  # space
        None,  # grant
    )

    assert result.decided_by["backfill"] == ChannelPolicyLevel.AGENT
    assert result.decided_by["session_scope"] == ChannelPolicyLevel.SPACE
    assert result.decided_by["forwardfill"] == ChannelPolicyLevel.CHANNEL
    assert result.decided_by["triggers"] == ChannelPolicyLevel.CHANNEL


def test_capability_conversation_units_ceiling_narrows_the_default():
    # a platform declaring only "message" must never resolve to "thread",
    # even when the channel default and every policy level are silent.
    no_threads = ChannelCapabilities(
        **{
            **SLACK,
            "conversation": {"units": ["space"], "default": "space"},
        }
    )
    defaults = ChannelPolicy(
        session_scope=ChannelSessionScope.THREAD,
        backfill=True,
        forwardfill=True,
    )

    result = resolve_policy(no_threads, defaults, None, None, None)

    assert result.session_scope == ChannelSessionScope.MESSAGE
    assert result.decided_by["session_scope"] == ChannelPolicyLevel.CAPABILITY
