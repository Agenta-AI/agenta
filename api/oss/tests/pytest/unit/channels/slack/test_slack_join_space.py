"""Adding a Slack channel puts the bot in it: a public channel is joined, a
private one needs a member to /invite the bot, and discovery says which
channels the bot is already in."""

from uuid import uuid4

import pytest

from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelSpaceMembership,
)
from oss.src.core.channels.types import ChannelSpaceJoinFailed
from oss.tests.pytest.unit.channels.slack.fake_slack import (
    make_adapter_and_workspace,
)

pytestmark = pytest.mark.asyncio


def _connection(**data_overrides) -> ChannelConnection:
    data = {
        "signing_secret": "test-signing-secret",
        "bot_token": "xoxb-fake",
        "bot_user_id": "UBOT1",
        "bot_username": "support-bot",
        "team_id": "T1",
    }
    data.update(data_overrides)
    return ChannelConnection(
        id=uuid4(),
        slug="slack-connection",
        channel="slack",
        external_key=uuid4(),
        data=data,
    )


def _methods(transport):
    return [r.url.path.rsplit("/", 1)[-1] for r in transport.requests]


# --- discovery -------------------------------------------------------------- #


async def test_discover_spaces_reports_whether_the_bot_is_in_each_channel():
    adapter, _workspace, _transport = make_adapter_and_workspace(
        channels=[
            {"id": "C1", "name": "joined", "is_member": True},
            {"id": "C2", "name": "public", "is_member": False},
            {"id": "C3", "name": "secret", "is_private": True, "is_member": True},
            {"id": "C4", "name": "hidden", "is_private": True, "is_member": False},
        ]
    )

    candidates = await adapter.discover_spaces(connection=_connection())

    membership = {c.display_name: c.membership for c in candidates}
    assert membership == {
        "joined": ChannelSpaceMembership.MEMBER,
        "public": ChannelSpaceMembership.JOINABLE,
        "secret": ChannelSpaceMembership.MEMBER,
        "hidden": ChannelSpaceMembership.INVITE_REQUIRED,
    }


async def test_discovered_channels_carry_the_workspace_real_connections_store():
    """Live QA 2026-09-23: real connections keep the workspace id in
    `connection_locator`, not a flat `team_id`. Discovery keyed every channel
    on `team=""`, so a channel the bot answered in read as not added, and an
    added channel never matched an inbound event (those carry the team)."""
    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )
    from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key

    adapter, _workspace, _transport = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "qa", "is_member": True}]
    )
    connection = _connection(
        team_id=None,
        connection_locator={"api_app_id": "A1", "enterprise_id": "", "team_id": "T9"},
    )

    [candidate] = await adapter.discover_spaces(connection=connection)

    assert candidate.external_locator == {"team": "T9", "channel": "C1"}
    capabilities = fetch_slack_capabilities()
    event_locator = {"team": "T9", "channel": "C1", "thread_ts": "1.2"}
    assert compose_external_key(
        capabilities, ChannelKeyGrain.SPACE, candidate.external_locator
    ) == compose_external_key(capabilities, ChannelKeyGrain.SPACE, event_locator)


# --- join_space ------------------------------------------------------------- #


async def test_adding_a_public_channel_joins_it():
    adapter, workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C2", "name": "public", "is_member": False}]
    )

    await adapter.join_space(
        connection=_connection(), locator={"team": "T1", "channel": "C2"}
    )

    assert workspace.channels["C2"]["is_member"] is True
    assert _methods(transport) == ["conversations.info", "conversations.join"]


async def test_adding_a_channel_the_bot_is_already_in_does_not_join_again():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "joined", "is_member": True}]
    )

    await adapter.join_space(
        connection=_connection(), locator={"team": "T1", "channel": "C1"}
    )

    assert _methods(transport) == ["conversations.info"]


async def test_a_private_channel_the_bot_is_in_is_accepted():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C3", "name": "s", "is_private": True, "is_member": True}]
    )

    await adapter.join_space(
        connection=_connection(), locator={"team": "T1", "channel": "C3"}
    )

    assert _methods(transport) == ["conversations.info"]


async def test_a_private_channel_the_bot_is_not_in_asks_for_an_invite_by_handle():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C4", "name": "s", "is_private": True, "is_member": False}]
    )

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await adapter.join_space(
            connection=_connection(), locator={"team": "T1", "channel": "C4"}
        )

    assert "/invite @support-bot" in str(raised.value)
    assert "conversations.join" not in _methods(transport)


async def test_the_invite_hint_falls_back_to_agenta_without_a_known_handle():
    adapter, _workspace, _transport = make_adapter_and_workspace(
        channels=[{"id": "C4", "name": "s", "is_private": True, "is_member": False}]
    )

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await adapter.join_space(
            connection=_connection(bot_username=None),
            locator={"team": "T1", "channel": "C4"},
        )

    assert "/invite @Agenta" in str(raised.value)


async def test_a_missing_channels_join_scope_says_to_reinstall():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C2", "name": "public", "is_member": False}]
    )
    transport.force_error("conversations.join", error="missing_scope")

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await adapter.join_space(
            connection=_connection(), locator={"team": "T1", "channel": "C2"}
        )

    assert "channels:join" in str(raised.value)
    assert "Reinstall" in str(raised.value)


async def test_an_archived_channel_is_refused():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C5", "name": "old", "is_archived": True}]
    )

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await adapter.join_space(
            connection=_connection(), locator={"team": "T1", "channel": "C5"}
        )

    assert "archived" in str(raised.value)
    assert "conversations.join" not in _methods(transport)


async def test_any_other_slack_refusal_is_surfaced_with_slacks_error():
    adapter, _workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C2", "name": "public", "is_member": False}]
    )
    transport.force_error("conversations.join", error="ratelimited")

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await adapter.join_space(
            connection=_connection(), locator={"team": "T1", "channel": "C2"}
        )

    assert "ratelimited" in str(raised.value)


# --- the bot's handle ------------------------------------------------------- #


async def test_verify_connection_records_the_bots_handle():
    adapter, _workspace, _transport = make_adapter_and_workspace(
        bot_username="support-bot"
    )

    discovered = await adapter.verify_connection(
        connection=ChannelConnectionCreate(
            channel="slack", external_key=uuid4(), slug="s"
        ),
        credentials={"bot_token": "xoxb-fake"},
    )

    assert discovered["bot_username"] == "support-bot"
