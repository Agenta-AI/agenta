"""`read_history`: one live page of Slack history before a timestamp, for the
channel read tool. Never stored; rate limits surface with Slack's wait."""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.types import ChannelRateLimited
from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace

pytestmark = pytest.mark.asyncio

LOCATOR = {"team": "T1", "channel": "C1"}


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack",
        channel="slack",
        external_key=uuid4(),
        data={"bot_token": "xoxb-fake", "bot_user_id": "UBOT1"},
    )


def _setup():
    adapter, workspace, transport = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    return adapter, workspace, transport


async def test_history_page_returns_only_messages_before_latest_oldest_first():
    adapter, workspace, transport = _setup()
    first = workspace.seed_message(channel="C1", text="one", user="U1")
    second = workspace.seed_message(channel="C1", text="two", user="U2")
    third = workspace.seed_message(channel="C1", text="three", user="UBOT1")

    page = await adapter.read_history(
        connection=_connection(), locator=LOCATOR, latest=third, limit=10
    )

    assert [m.text for m in page] == ["one", "two"]
    assert [m.message_ref for m in page] == [first, second]
    request = [r for r in transport.requests if "conversations.history" in r.url.path]
    assert request[0].url.params["latest"] == third
    assert request[0].url.params["inclusive"] == "false"


async def test_history_marks_the_bots_own_posts():
    adapter, workspace, _ = _setup()
    workspace.seed_message(channel="C1", text="from a person", user="U1")
    workspace.seed_message(channel="C1", text="from the bot", user="UBOT1")

    page = await adapter.read_history(
        connection=_connection(), locator=LOCATOR, limit=10
    )

    assert [(m.text, m.from_bot) for m in page] == [
        ("from a person", False),
        ("from the bot", True),
    ]


async def test_replies_page_returns_root_and_replies():
    adapter, workspace, _ = _setup()
    root = workspace.seed_message(channel="C1", text="root", user="U1")
    workspace.seed_message(channel="C1", text="reply", user="U2", thread_ts=root)
    workspace.seed_message(channel="C1", text="other", user="U1")

    page = await adapter.read_history(
        connection=_connection(), locator=LOCATOR, thread_ts=root, limit=10
    )

    assert [m.text for m in page] == ["root", "reply"]
    assert {m.thread_ref for m in page} == {root}


async def test_429_raises_rate_limited_with_retry_after():
    adapter, _, transport = _setup()
    transport.force_error(
        "conversations.history",
        error="ratelimited",
        status_code=429,
        headers={"Retry-After": "40"},
    )

    with pytest.raises(ChannelRateLimited) as raised:
        await adapter.read_history(connection=_connection(), locator=LOCATOR, limit=10)

    assert raised.value.retry_after == 40


async def test_missing_scope_raises_backfill_refused():
    adapter, _, transport = _setup()
    transport.force_error("conversations.history", error="missing_scope")

    with pytest.raises(ChannelBackfillRefused):
        await adapter.read_history(connection=_connection(), locator=LOCATOR, limit=10)
