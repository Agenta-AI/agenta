"""Vercel stream message id selection for resumed assistant turns."""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream


async def _events(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


async def _collect(*, message_id: Optional[str], trace_id: str) -> List[Dict[str, Any]]:
    return [
        part
        async for part in agent_stream_to_vercel_stream(
            _events([]), message_id=message_id, trace_id=trace_id
        )
    ]


@pytest.mark.asyncio
async def test_explicit_message_id_wins_over_trace_id_default() -> None:
    parts = await _collect(message_id="msg-abc", trace_id="trace-1")

    start = parts[0]
    assert start["type"] == "start"
    assert start["messageId"] == "msg-abc"


@pytest.mark.asyncio
async def test_missing_message_id_falls_back_to_trace_id_default() -> None:
    parts = await _collect(message_id=None, trace_id="trace-1")

    start = parts[0]
    assert start["type"] == "start"
    assert start["messageId"] == "msg-trace-1"
