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

    assert [m.text for m in page.messages] == ["one", "two"]
    assert [m.message_ref for m in page.messages] == [first, second]
    assert page.has_more is False
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

    assert [(m.text, m.from_bot) for m in page.messages] == [
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

    assert [m.text for m in page.messages] == ["root", "reply"]
    assert {m.thread_ref for m in page.messages} == {root}


async def test_a_short_page_with_more_history_says_so():
    adapter, workspace, _ = _setup()
    for i in range(5):
        last = workspace.seed_message(channel="C1", text=f"m{i}", user="U1")

    page = await adapter.read_history(
        connection=_connection(), locator=LOCATOR, latest=last, limit=2
    )

    assert [m.text for m in page.messages] == ["m2", "m3"]
    assert page.has_more is True


async def test_thread_pages_forward_from_the_root_with_slacks_cursor():
    adapter, workspace, _ = _setup()
    root = workspace.seed_message(channel="C1", text="root", user="U1")
    for i in range(5):
        workspace.seed_message(channel="C1", text=f"r{i}", user="U2", thread_ts=root)

    first = await adapter.read_history(
        connection=_connection(), locator=LOCATOR, thread_ts=root, limit=4
    )
    rest = await adapter.read_history(
        connection=_connection(),
        locator=LOCATOR,
        thread_ts=root,
        cursor=first.next_cursor,
        limit=4,
    )

    assert [m.text for m in first.messages + rest.messages] == [
        "root",
        "r0",
        "r1",
        "r2",
        "r3",
        "r4",
    ]
    assert first.has_more and not rest.has_more


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
