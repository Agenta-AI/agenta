"""WP25: `errorDetail` (the runner's `AgentErrorDetail`, WP13) must reach the caller on the
vercel stream, not stop at `AgentRunFailed`.

`result_from_wire` already raises `AgentRunFailed(message, error_detail=...)` on `ok: false`
(``utils/wire.py``), and nothing between there and the stream adapters rewraps it — verified by
reading ``streaming.py`` and ``decorators/routing.py`` (WP25's spec doc). This pins that survival
end to end, and pins the five refusals ``launch-3.md`` names by their real gateway codes
(``api/oss/src/apis/fastapi/gateways/llms/proxy.py`` ``_map_domain_exception``).
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.errors import AgentRunFailed
from agenta.sdk.agents.streaming import AgentStream

REFUSALS = [
    {  # missing credential
        "code": "secret_missing",
        "message": "No project secret for anthropic under mode standard",
        "next_step": "configure the connection's secret",
    },
    {  # rejected credential (SecretInvalidError -- revoked or refresh failed)
        "code": "secret_invalid",
        "message": "Secret for anthropic:project-42 is invalid",
        "next_step": "reconnect the connection's secret",
    },
    {  # unregistered target
        "code": "endpoint_not_found",
        "message": "No endpoint named 'staging-claude'",
        "next_step": "check the endpoint configuration",
    },
    {  # disallowed model
        "code": "model_not_allowed",
        "message": "model not allowed: gpt-5.5-experimental",
        "next_step": "choose a model the connection allows",
    },
    {  # deactivated endpoint
        "code": "endpoint_inactive",
        "message": "Endpoint 'prod-openai' is inactive",
        "next_step": "reactivate the endpoint, or choose another",
    },
]


def _wire_result(detail: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": detail["message"],
        "errorDetail": {
            "code": detail["code"],
            "message": detail["message"],
            "retryable": False,
            **({"next_step": detail["next_step"]} if "next_step" in detail else {}),
        },
    }


async def _failing_records(detail: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
    yield {"kind": "result", "result": _wire_result(detail)}


async def _failing_events(detail: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
    if False:  # pragma: no cover - makes this an async generator
        yield {}
    raise AgentRunFailed(
        detail["message"], error_detail=_wire_result(detail)["errorDetail"]
    )


async def _drain(parts: AsyncIterator[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [part async for part in parts]


def _agent_error_data(parts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for part in parts:
        if part["type"] == "data-agent-error":
            return part["data"]
    return None


async def test_dev_twin_carries_error_detail_from_a_failed_terminal_result():
    for detail in REFUSALS:
        parts = await _drain(
            agent_run_to_vercel_parts(AgentStream(_failing_records(detail)))
        )
        data = _agent_error_data(parts)
        assert data is not None, detail["code"]
        assert data["code"] == detail["code"]
        assert data["errorDetail"] == _wire_result(detail)["errorDetail"]


async def test_live_twin_carries_error_detail_from_a_raised_agent_run_failed():
    for detail in REFUSALS:
        parts = await _drain(agent_stream_to_vercel_stream(_failing_events(detail)))
        data = _agent_error_data(parts)
        assert data is not None, detail["code"]
        assert data["code"] == detail["code"]
        assert data["errorDetail"] == _wire_result(detail)["errorDetail"]


async def test_error_frame_and_error_text_are_unchanged_by_error_detail():
    # A caller reading only `error`/`errorText` must see no regression.
    detail = REFUSALS[0]
    parts = await _drain(agent_stream_to_vercel_stream(_failing_events(detail)))
    error_frames = [p for p in parts if p["type"] == "error"]
    assert len(error_frames) == 1
    # sanitize_runner_error reads str(exc), which AgentRunFailed prefixes ("Agent run
    # failed: ..."); the point of this test is that adding errorDetail didn't change it.
    assert error_frames[0]["errorText"] == f"Agent run failed: {detail['message']}"


async def test_error_detail_is_omitted_not_null_for_a_plain_failure():
    async def _plain_failure() -> AsyncIterator[Dict[str, Any]]:
        if False:  # pragma: no cover
            yield {}
        raise RuntimeError("runner died mid-stream")

    parts = await _drain(agent_stream_to_vercel_stream(_plain_failure()))
    data = _agent_error_data(parts)
    assert data is not None
    assert "errorDetail" not in data
