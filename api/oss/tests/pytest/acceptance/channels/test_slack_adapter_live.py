"""Acceptance: SlackAdapter against the real Slack Web API.

Gated on SLACK_BOT_TOKEN + SLACK_TEST_CHANNEL — a live workspace + bot install
with chat:write and channels:history granted. Exercises exactly the
checkpoint condition the adapter owns: post produces a real message, edit
changes it in place, backfill returns real history or a distinguishable
refusal.
"""

import os
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection

pytestmark = pytest.mark.acceptance

_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
_TEST_CHANNEL = os.getenv("SLACK_TEST_CHANNEL")
_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET")

_requires_live_slack = pytest.mark.skipif(
    not (_BOT_TOKEN and _TEST_CHANNEL),
    reason="needs live Slack credentials (SLACK_BOT_TOKEN, SLACK_TEST_CHANNEL)",
)


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack-acceptance",
        channel="slack",
        external_key=uuid4(),
        data={
            "bot_token": _BOT_TOKEN,
            "signing_secret": _SIGNING_SECRET,
        },
    )


@_requires_live_slack
class TestSlackAdapterLive:
    async def test_post_then_edit_against_a_real_channel(self):
        adapter = SlackAdapter(http_client=httpx.AsyncClient())
        connection = _connection()

        receipt = await adapter.post_message(
            connection=connection,
            locator={"channel": _TEST_CHANNEL},
            content=[
                {"type": "text", "text": "Slack adapter acceptance check: posting"}
            ],
            idempotency_key=uuid4(),
        )
        edited = await adapter.edit_message(
            connection=connection,
            external_locator=receipt,
            content=[
                {"type": "text", "text": "Slack adapter acceptance check: edited"}
            ],
            idempotency_key=uuid4(),
        )

        assert edited["ts"] == receipt["ts"]

    async def test_discover_spaces_lists_the_test_channel(self):
        adapter = SlackAdapter(http_client=httpx.AsyncClient())
        connection = _connection()

        candidates = await adapter.discover_spaces(connection=connection)

        assert any(
            c.external_locator.get("channel") == _TEST_CHANNEL for c in candidates
        )

    async def test_backfill_returns_history_or_a_distinguishable_refusal(self):
        from oss.src.core.channels.adapters.slack.adapter import (
            ChannelBackfillRefused,
        )

        adapter = SlackAdapter(http_client=httpx.AsyncClient())
        connection = _connection()

        try:
            history = await adapter.fetch_history(
                connection=connection,
                locator={"team": "T", "channel": _TEST_CHANNEL},
                limit=10,
            )
            assert isinstance(history, list)
        except ChannelBackfillRefused:
            pass  # a refusal is an acceptable, distinguishable outcome too
