"""OR28: the gateway's refusal envelope must reach the client on the LIVE leg too.

Measured live on 2026-09-12, a data-plane ``403 model_not_allowed``: the browser got
``{"code": "runner_error", "errorText": "403: {...}"}`` and nothing a client could match on,
because the runner's ``error`` event had no field for the envelope and the terminal frame that
does carry one is suppressed once a live error has been emitted.
"""

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


DETAIL = {
    "code": "model_not_allowed",
    "message": "Model mock/echo not allowed on custom/or28",
    "retryable": False,
    "next_step": "choose a model the connection allows",
}


async def _agent_error(event_data: Dict[str, Any]) -> Dict[str, Any]:
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _records([{"type": "error", "data": event_data}])
        )
    ]
    return next(part for part in parts if part["type"] == "data-agent-error")


@pytest.mark.asyncio
async def test_the_envelope_rides_the_live_error_frame() -> None:
    frame = await _agent_error(
        {"message": "403: refused", "code": "runner_error", "detail": DETAIL}
    )

    assert frame["data"]["errorDetail"] == DETAIL
    # The generic runner class carries nothing the gateway's own code does not carry better.
    assert frame["data"]["code"] == "model_not_allowed"
    assert frame["data"]["errorText"] == "403: refused"


@pytest.mark.asyncio
async def test_a_named_runner_class_outranks_the_gateway_code() -> None:
    """A run that stopped for a reason the client has its own recovery path for keeps it."""
    frame = await _agent_error(
        {
            "message": "out of credits",
            "code": "starter_credits_exhausted",
            "detail": DETAIL,
        }
    )

    assert frame["data"]["code"] == "starter_credits_exhausted"
    assert frame["data"]["errorDetail"] == DETAIL


@pytest.mark.asyncio
async def test_an_error_without_an_envelope_is_unchanged() -> None:
    frame = await _agent_error({"message": "sandbox went away", "code": "sandbox_gone"})

    assert frame["data"] == {"code": "sandbox_gone", "errorText": "sandbox went away"}
