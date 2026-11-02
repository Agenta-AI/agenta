"""The `subscription_login_required` code, on both halves of the hosted subscription feature.

A client shows one "Sign in again" affordance, keyed on one code. Two different producers emit
it: the runner, when a live turn's login is rejected, and the SDK resolver, when the stored
login is not ready. Both must reach the browser as the SAME frame code, or the client has to
learn two vocabularies for one situation.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_run_to_vercel_parts
from agenta.sdk.agents.connections import SubscriptionLoginRequiredError
from agenta.sdk.agents.streaming import AgentStream

_CODE = "subscription_login_required"


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


async def _raises(error: BaseException) -> AsyncIterator[Dict[str, Any]]:
    raise error
    yield {}  # pragma: no cover - makes this an async generator


def _error_frames(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [part for part in parts if part["type"] == "data-agent-error"]


@pytest.mark.asyncio
async def test_runner_reported_login_failure_keeps_its_code() -> None:
    # The runner classifies a rejected login and names the code itself.
    run = AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "error",
                        # The runner puts both at the top level of the event.
                        "code": _CODE,
                        "message": (
                            "The ChatGPT sign-in is no longer valid. "
                            "Sign in again from AI providers."
                        ),
                    },
                },
                {"kind": "result", "result": {"ok": True, "output": ""}},
            ]
        )
    )

    frames = _error_frames([part async for part in agent_run_to_vercel_parts(run)])

    assert len(frames) == 1
    assert frames[0]["data"]["code"] == _CODE


@pytest.mark.asyncio
async def test_resolution_error_carries_its_failure_code_onto_the_frame() -> None:
    # The typed resolver error names the same code, so a failure raised into the stream is
    # indistinguishable to the client from the runner's own.
    error = SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    run = AgentStream(_raises(error))

    frames = _error_frames([part async for part in agent_run_to_vercel_parts(run)])

    assert len(frames) == 1
    assert frames[0]["data"]["code"] == _CODE
    assert frames[0]["data"]["errorText"] == (
        "The ChatGPT sign-in is not ready. Sign in from AI providers."
    )


def test_the_error_message_names_no_credential() -> None:
    error = SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    message = str(error)
    assert "token" not in message.lower()
    assert "auth.json" not in message
    # The code is a stable slug the client branches on, never prose.
    assert error.failure_code == _CODE
