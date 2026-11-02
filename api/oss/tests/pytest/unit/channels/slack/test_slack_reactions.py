import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import SlackAdapter, _SlackApiError
from .test_slack_adapter import _connection


@pytest.mark.parametrize("thread_ts", [None, "100.001"])
async def test_parse_keeps_message_timestamp_separate_from_thread(thread_ts):
    adapter = SlackAdapter()
    event = {"type": "message", "channel": "C1", "ts": "200.002", "text": "hello"}
    if thread_ts:
        event["thread_ts"] = thread_ts
    parsed = await adapter.parse_event(
        body=json.dumps(
            {"type": "event_callback", "team_id": "T1", "event": event}
        ).encode()
    )
    assert parsed.external_locator["message_ts"] == "200.002"
    assert parsed.external_locator["thread_ts"] == (thread_ts or "200.002")


@pytest.mark.parametrize(
    "status,expected",
    [
        ("received", [("reactions.add", "eyes")]),
        (
            "completed",
            [("reactions.add", "white_check_mark"), ("reactions.remove", "eyes")],
        ),
        ("failed", [("reactions.remove", "eyes")]),
    ],
)
async def test_reactions_use_bot_token_and_original_message(status, expected):
    calls = []

    def handle(request):
        assert request.headers["Authorization"] == "Bearer xoxb-fake"
        payload = json.loads(request.content)
        assert payload["channel"] == "C1"
        assert payload["timestamp"] == "200.002"
        calls.append((request.url.path.rsplit("/", 1)[-1], payload["name"]))
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(
        base_url="https://slack.com/api/", transport=httpx.MockTransport(handle)
    ) as client:
        adapter = SlackAdapter(http_client=client)
        await adapter.set_message_status(
            connection=_connection(),
            locator={"channel": "C1", "thread_ts": "100.001", "message_ts": "200.002"},
            status=status,
        )
    assert calls == expected


@pytest.mark.parametrize(
    "error", ["already_reacted", "missing_scope", "ratelimited", "message_not_found"]
)
async def test_add_failure_does_not_prevent_removing_eyes(error):
    adapter = SlackAdapter()
    adapter._call = AsyncMock(
        side_effect=[_SlackApiError(error=error, status_code=200), {"ok": True}]
    )
    await adapter.set_message_status(
        connection=_connection(),
        locator={"channel": "C1", "message_ts": "200.002"},
        status="completed",
    )
    assert adapter._call.await_count == 2
    assert adapter._call.call_args.args[1] == "reactions.remove"


async def test_already_removed_is_harmless():
    adapter = SlackAdapter()
    adapter._call = AsyncMock(
        side_effect=_SlackApiError(error="no_reaction", status_code=200)
    )
    await adapter.set_message_status(
        connection=_connection(),
        locator={"channel": "C1", "message_ts": "200.002"},
        status="failed",
    )


async def test_timeout_is_bounded_and_does_not_escape():
    adapter = SlackAdapter()

    async def blocked(*args):
        await asyncio.sleep(10)

    adapter._call = blocked
    await asyncio.wait_for(
        adapter.set_message_status(
            connection=_connection(),
            locator={"channel": "C1", "message_ts": "200.002"},
            status="received",
        ),
        timeout=2,
    )


async def test_old_event_does_not_react_to_thread_root():
    adapter = SlackAdapter()
    adapter._call = AsyncMock()
    await adapter.set_message_status(
        connection=_connection(),
        locator={"channel": "C1", "thread_ts": "100.001"},
        status="completed",
    )
    adapter._call.assert_not_called()
