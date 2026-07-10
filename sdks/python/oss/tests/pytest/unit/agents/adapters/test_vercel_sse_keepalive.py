"""The Vercel SSE framing keeps a slow-but-alive run warm with keepalive comments.

A proxy or load balancer idle-kills a connection with no bytes flowing. A run whose next part is
minutes away (a long tool call) is still alive and still billing server-side, so the SSE framing
emits an inert ``: keepalive`` comment on a periodic tick during silent gaps. These tests pin
that a keepalive appears on a silent gap, that it never alters the data frames, and that the
terminal ``[DONE]`` still lands.
"""

from __future__ import annotations

import asyncio
import importlib
import json
from typing import AsyncIterator, List

import agenta.sdk.agents.adapters.vercel.sse as sse_module


async def _collect(aiter) -> List[str]:
    return [chunk async for chunk in aiter]


def _reload_with_interval(monkeypatch, seconds: str):
    """Reload the sse module so the module-level keepalive interval picks up the env override."""
    monkeypatch.setenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", seconds)
    return importlib.reload(sse_module)


def _reload_default(monkeypatch):
    """Reload the module back to its default interval so the override cannot leak (the read is
    at import time; unset before reloading, since monkeypatch reverts only after the test)."""
    monkeypatch.delenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", raising=False)
    importlib.reload(sse_module)


def _sse_payload(chunk: str) -> str:
    assert chunk.startswith("data: ") and chunk.endswith("\n\n")
    return chunk[len("data: ") : -2]


async def test_keepalive_comment_is_emitted_during_a_silent_gap(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "0.02")
    try:

        async def parts() -> AsyncIterator[dict]:
            yield {"type": "start"}
            # A long gap (several keepalive intervals) before the next data frame.
            await asyncio.sleep(0.1)
            yield {"type": "finish"}

        chunks = await _collect(mod.vercel_sse_stream(parts()))
    finally:
        _reload_default(monkeypatch)

    keepalives = [c for c in chunks if c == ": keepalive\n\n"]
    data_frames = [c for c in chunks if c.startswith("data: ")]

    # At least one keepalive rode the silent gap.
    assert len(keepalives) >= 1
    # The data frames are exactly the two parts plus the terminal [DONE], in order and unaltered.
    assert data_frames[0] == "data: " + json.dumps({"type": "start"}) + "\n\n"
    assert data_frames[1] == "data: " + json.dumps({"type": "finish"}) + "\n\n"
    assert data_frames[-1] == "data: [DONE]\n\n"


async def test_no_keepalive_when_parts_flow_within_the_interval(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "5")
    try:

        async def parts() -> AsyncIterator[dict]:
            yield {"type": "start"}
            yield {"type": "text-delta", "id": "t1", "delta": "hi"}
            yield {"type": "finish"}

        chunks = await _collect(mod.vercel_sse_stream(parts()))
    finally:
        _reload_default(monkeypatch)

    assert not any(c == ": keepalive\n\n" for c in chunks)
    # Byte-for-byte the pre-keepalive framing: one data frame per part, then [DONE].
    assert len(chunks) == 4
    assert json.loads(_sse_payload(chunks[0])) == {"type": "start"}
    assert json.loads(_sse_payload(chunks[1])) == {
        "type": "text-delta",
        "id": "t1",
        "delta": "hi",
    }
    assert chunks[-1] == "data: [DONE]\n\n"


async def test_keepalive_disabled_by_zero_still_frames_and_terminates(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "0")
    try:

        async def parts() -> AsyncIterator[dict]:
            yield {"type": "start"}
            yield {"type": "finish"}

        chunks = await _collect(mod.vercel_sse_stream(parts()))
    finally:
        _reload_default(monkeypatch)

    assert not any(c == ": keepalive\n\n" for c in chunks)
    assert chunks == [
        "data: " + json.dumps({"type": "start"}) + "\n\n",
        "data: " + json.dumps({"type": "finish"}) + "\n\n",
        "data: [DONE]\n\n",
    ]


async def test_empty_stream_still_emits_done_with_keepalive_enabled(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "0.02")
    try:

        async def parts() -> AsyncIterator[dict]:
            return
            yield  # pragma: no cover — makes this an async generator

        chunks = await _collect(mod.vercel_sse_stream(parts()))
    finally:
        _reload_default(monkeypatch)

    assert chunks == ["data: [DONE]\n\n"]


def test_non_numeric_interval_falls_back_to_default(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "not-a-number")
    try:
        assert mod._KEEPALIVE_INTERVAL_SECONDS == 15.0
    finally:
        _reload_default(monkeypatch)


def test_negative_interval_clamps_to_disabled(monkeypatch):
    mod = _reload_with_interval(monkeypatch, "-5")
    try:
        assert mod._KEEPALIVE_INTERVAL_SECONDS == 0.0
    finally:
        _reload_default(monkeypatch)
