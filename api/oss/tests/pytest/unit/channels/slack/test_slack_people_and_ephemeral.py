"""The Slack adapter's channel-limits calls against the fake Slack Web API:
the private note (chat.postEphemeral) and the people picker (users.list,
users.lookupByEmail)."""

import pytest

from uuid import uuid4

from oss.src.core.channels.dtos import ChannelConnection, ChannelConnectionFlags
from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace

pytestmark = pytest.mark.asyncio


def _connection():
    return ChannelConnection(
        id=uuid4(),
        slug="slack",
        channel="slack",
        external_key=uuid4(),
        data={"team_id": "T-fake", "bot_token": "xoxb-fake"},
        flags=ChannelConnectionFlags(is_verified=True),
    )


def _member(i, **extra):
    return {
        "id": f"U{i}",
        "name": f"user{i}",
        "real_name": f"User {i}",
        "profile": {"email": f"user{i}@example.com"},
        **extra,
    }


async def test_an_ephemeral_note_reaches_only_the_person():
    adapter, workspace, _ = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="random")

    shown = await adapter.post_ephemeral(
        connection=_connection(),
        locator={"team": "T-fake", "channel": "C1", "thread_ts": "1.1"},
        recipient_id="U2",
        content=[
            {"type": "text", "text": "This agent does not answer in this channel."}
        ],
    )

    assert shown is True
    assert workspace.ephemerals == [
        {
            "channel": "C1",
            "user": "U2",
            "text": "This agent does not answer in this channel.",
            "thread_ts": "1.1",
        }
    ]
    assert workspace.messages == {}  # nothing anyone else can see


async def test_a_refused_ephemeral_raises_for_the_caller_to_log():
    adapter, workspace, _ = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="random")
    workspace.channel_members["C1"] = ["U1"]

    with pytest.raises(Exception):
        await adapter.post_ephemeral(
            connection=_connection(),
            locator={"channel": "C1"},
            recipient_id="U2",
            content=[{"type": "text", "text": "note"}],
        )


async def test_list_people_reads_every_page():
    adapter, workspace, _ = make_adapter_and_workspace()
    workspace.members = [
        _member(1),
        _member(2, is_restricted=True),
        _member(3, is_bot=True),
        _member(4, deleted=True),
        {"id": "USLACKBOT", "name": "slackbot"},
    ]

    import oss.src.core.channels.adapters.slack.adapter as slack_adapter

    original = slack_adapter._PEOPLE_PAGE_SIZE
    slack_adapter._PEOPLE_PAGE_SIZE = 2
    try:
        people = await adapter.list_people(connection=_connection())
    finally:
        slack_adapter._PEOPLE_PAGE_SIZE = original

    assert [person.id for person in people] == ["U1", "U2", "U3", "U4"]
    assert people[0].name == "User 1"
    assert people[0].email == "user1@example.com"
    assert people[0].source == "directory"
    assert people[1].is_guest is True
    assert people[2].is_bot is True
    assert people[3].is_deleted is True


async def test_list_people_waits_out_a_rate_limit(monkeypatch):
    import oss.src.core.channels.adapters.slack.adapter as slack_adapter

    async def _no_wait(_seconds):
        return None

    monkeypatch.setattr(slack_adapter.asyncio, "sleep", _no_wait)
    adapter, workspace, transport = make_adapter_and_workspace()
    workspace.members = [_member(1)]
    transport.force_error(
        "users.list", error="ratelimited", status_code=429, headers={"Retry-After": "1"}
    )

    people = await adapter.list_people(connection=_connection())

    assert [person.id for person in people] == ["U1"]


async def test_find_person_by_email():
    adapter, workspace, _ = make_adapter_and_workspace()
    workspace.members = [_member(7)]

    found = await adapter.find_person_by_email(
        connection=_connection(), email="user7@example.com"
    )
    missing = await adapter.find_person_by_email(
        connection=_connection(), email="nobody@example.com"
    )

    assert found is not None and found.id == "U7" and found.source == "email_lookup"
    assert missing is None
