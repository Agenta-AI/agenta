"""Live cold Pi turn against a real local runner. Skips without runner prerequisites."""

import json
import os
from collections.abc import AsyncIterator

import pytest
from agenta_local.core.agents.dtos import AgentModel, AgentRevision
from agenta_local.core.execution.dtos import ExecutionCredential, ExecutionMessage
from agenta_local.core.execution.errors import ExecutionError
from agenta_local.execution.sdk.adapter import SDKAgentExecutor

from tests.pytest.utils.live_runner import requires_live_runner

pytestmark = pytest.mark.integration

INSTRUCTIONS = "You are a helpful research assistant."
PROMPT = "Say hello in one short sentence."
PROVIDER = os.environ.get("AGENTA_LOCAL_LIVE_PROVIDER", "anthropic")
MODEL = os.environ.get("AGENTA_LOCAL_LIVE_MODEL", "claude-sonnet-4-5")


def _revision() -> AgentRevision:
    return AgentRevision(
        id="live",
        version=1,
        instructions=INSTRUCTIONS,
        model=AgentModel(provider=PROVIDER, name=MODEL),
    )


async def _drain(events: AsyncIterator) -> list:
    collected = []
    async for event in events:
        collected.append(event.payload)
    return collected


@requires_live_runner
async def test_cold_turn_streams_to_completion_and_cleans_up(
    live_runner_url: str,
) -> None:
    api_key = os.environ.get(f"{PROVIDER.upper()}_API_KEY")
    if not api_key:
        pytest.skip(f"{PROVIDER.upper()}_API_KEY is not set")

    executor = SDKAgentExecutor(runner_url=live_runner_url)

    stream = executor.stream(
        revision=_revision(),
        messages=[ExecutionMessage(role="user", content=PROMPT)],
        credential=ExecutionCredential(provider=PROVIDER, api_key=api_key),
    )
    frames = await _drain(stream.events)
    assert frames[0]["type"] == "start"
    assert frames[-2]["type"] == "finish-step"
    assert frames[-1]["type"] == "finish"
    result = await stream.result()
    assert isinstance(result.assistant_text, str) and result.assistant_text


@requires_live_runner
async def test_outbound_run_request_carries_null_session_id(
    live_runner_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    api_key = os.environ.get(f"{PROVIDER.upper()}_API_KEY")
    if not api_key:
        pytest.skip(f"{PROVIDER.upper()}_API_KEY is not set")

    captured: dict = {}
    from agenta.sdk.agents.adapters import sandbox_agent

    original = sandbox_agent.SandboxAgentBackend._deliver_stream

    def spying_deliver_stream(self, payload):
        captured.update(payload)
        return original(self, payload)

    monkeypatch.setattr(
        sandbox_agent.SandboxAgentBackend,
        "_deliver_stream",
        spying_deliver_stream,
    )

    executor = SDKAgentExecutor(runner_url=live_runner_url)
    stream = executor.stream(
        revision=_revision(),
        messages=[ExecutionMessage(role="user", content=PROMPT)],
        credential=ExecutionCredential(provider=PROVIDER, api_key=api_key),
    )
    await _drain(stream.events)
    try:
        await stream.result()
    except ExecutionError:
        pass  # model behavior varies; only the wire identity is under test here

    assert captured, "no /run request was delivered to the runner"
    wire_request = json.loads(json.dumps(captured))
    assert wire_request.get("sessionId") is None
