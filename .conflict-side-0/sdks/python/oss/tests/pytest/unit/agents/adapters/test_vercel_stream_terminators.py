"""SDK-3: both stream twins must guarantee the terminators on every exit path.

The routing-layer twin (``agent_stream_to_vercel_stream``) drains to ``finish-step`` + ``finish``
from a ``finally:``, so a consumer waiting on the finish frame never hangs. The dev-only twin
(``agent_run_to_vercel_parts``) used to ``return`` straight out of its ``except``, ending the
stream on the error part with no terminators. This pins both to the same contract.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.streaming import AgentStream


async def _exploding_records() -> AsyncIterator[Dict[str, Any]]:
    yield {"kind": "event", "event": {"type": "text_delta", "text": "hi"}}
    raise RuntimeError("runner died mid-stream")


async def _exploding_events() -> AsyncIterator[Dict[str, Any]]:
    yield {"type": "text_delta", "data": {"text": "hi"}}
    raise RuntimeError("runner died mid-stream")


async def _drain(parts: AsyncIterator[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [part async for part in parts]


async def test_dev_twin_emits_terminators_after_a_mid_stream_error():
    parts = await _drain(agent_run_to_vercel_parts(AgentStream(_exploding_records())))
    types = [part["type"] for part in parts]

    assert "error" in types
    # The terminators must still arrive, or a consumer waiting on `finish` hangs.
    assert "finish-step" in types
    assert types[-1] == "finish"


async def test_live_twin_emits_terminators_after_a_mid_stream_error():
    # The normative twin — asserted alongside so the two can never drift apart again.
    parts = await _drain(agent_stream_to_vercel_stream(_exploding_events()))
    types = [part["type"] for part in parts]

    assert "error" in types
    assert "finish-step" in types
    assert types[-1] == "finish"


async def test_both_twins_terminate_identically_on_a_mid_stream_error():
    # SDK-3 itself: the two twins disagreed (the dev one returned early, skipping both
    # terminators). Pin them to the SAME terminal shape so they cannot drift again.
    dev = await _drain(agent_run_to_vercel_parts(AgentStream(_exploding_records())))
    live = await _drain(agent_stream_to_vercel_stream(_exploding_events()))

    assert [part["type"] for part in dev] == [part["type"] for part in live]
