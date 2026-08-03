from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents import AgentRunFailed
from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.streaming import AgentStream


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


DELIVERY = {
    "attachmentId": "01996b6c-7b6b-7000-8000-000000000001",
    "outcome": "workspace_only",
    "reasonCode": "model_modality_unknown",
    "workingPath": "attachments/01996b6c-7b6b-7000-8000-000000000001/photo.png",
}


@pytest.mark.asyncio
async def test_live_twin_projects_attachment_delivery() -> None:
    events = _records([{"type": "attachment_delivery", "data": DELIVERY}])

    parts = [part async for part in agent_stream_to_vercel_stream(events)]

    delivery = next(
        part for part in parts if part["type"] == "data-attachment-delivery"
    )
    assert delivery == {"type": "data-attachment-delivery", "data": DELIVERY}


@pytest.mark.asyncio
async def test_dev_twin_projects_attachment_delivery() -> None:
    records = [
        {"kind": "event", "event": {"type": "attachment_delivery", **DELIVERY}},
        {"kind": "result", "result": {"ok": True}},
    ]
    run = AgentStream(_records(records))

    parts = [part async for part in agent_run_to_vercel_parts(run)]

    delivery = next(
        part for part in parts if part["type"] == "data-attachment-delivery"
    )
    assert delivery == {"type": "data-attachment-delivery", "data": DELIVERY}


@pytest.mark.asyncio
async def test_attachment_delivery_omits_absent_fields() -> None:
    events = _records(
        [
            {
                "type": "attachment_delivery",
                "data": {
                    "attachmentId": "01996b6c-7b6b-7000-8000-000000000001",
                    "outcome": "native",
                    "reasonCode": None,
                    "workingPath": None,
                },
            }
        ]
    )

    parts = [part async for part in agent_stream_to_vercel_stream(events)]

    delivery = next(
        part for part in parts if part["type"] == "data-attachment-delivery"
    )
    assert delivery == {
        "type": "data-attachment-delivery",
        "data": {
            "attachmentId": "01996b6c-7b6b-7000-8000-000000000001",
            "outcome": "native",
        },
    }


def _assert_error_pair(
    parts: List[Dict[str, Any]], *, code: str, error_text: str
) -> None:
    error_index = next(
        index for index, part in enumerate(parts) if part["type"] == "error"
    )
    assert parts[error_index - 1] == {
        "type": "data-agent-error",
        "data": {"code": code, "errorText": error_text},
    }
    error = parts[error_index]
    assert error == {"type": "error", "errorText": error_text}
    assert set(error) == {"type", "errorText"}


class ProviderUnavailableFailure(AgentRunFailed):
    failure_code = "provider_unavailable"


@pytest.mark.asyncio
async def test_live_twin_emits_failure_code_data_before_strict_error_frame() -> None:
    async def _failed() -> AsyncIterator[Dict[str, Any]]:
        if False:
            yield {}
        raise ProviderUnavailableFailure("provider unavailable")

    parts = [part async for part in agent_stream_to_vercel_stream(_failed())]

    _assert_error_pair(
        parts,
        code="provider_unavailable",
        error_text="Agent run failed: provider unavailable",
    )


@pytest.mark.asyncio
async def test_dev_twin_emits_default_code_data_before_strict_error_frame() -> None:
    run = AgentStream(
        _records(
            [
                {
                    "kind": "result",
                    "result": {"ok": False, "error": "provider unavailable"},
                }
            ]
        )
    )

    parts = [part async for part in agent_run_to_vercel_parts(run)]

    _assert_error_pair(
        parts,
        code="agent_run_failed",
        error_text="Agent run failed: provider unavailable",
    )
