from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from agenta.sdk.agents.tools import BuiltinToolConfig, GatewayToolConfig

from oss.src.core.tools.exceptions import ActionNotFoundError
from oss.src.core.tools.service import ToolsService


def _ref(action: str) -> GatewayToolConfig:
    return GatewayToolConfig(integration="github", action=action, connection="c1")


def _service(monkeypatch, get_action) -> ToolsService:
    service = object.__new__(ToolsService)

    async def _connection(**_kwargs):
        return object()

    monkeypatch.setattr(service, "resolve_connection_by_slug", _connection)
    monkeypatch.setattr(service, "get_action", get_action)
    return service


def _action(key: str):
    return SimpleNamespace(description=key, schemas=None, read_only=True)


async def test_resolve_tools_runs_references_together_and_keeps_order(monkeypatch):
    second_started = asyncio.Event()

    async def _get_action(*, action_key, **_kwargs):
        if action_key == "FIRST":
            # Finishes only once the second reference is in flight, so a serial loop hangs.
            await asyncio.wait_for(second_started.wait(), timeout=1)
        else:
            second_started.set()
        return _action(action_key)

    service = _service(monkeypatch, _get_action)
    result = await service.resolve_tools(
        project_id=uuid4(),
        tools=[_ref("FIRST"), BuiltinToolConfig(name="read"), _ref("SECOND")],
    )

    assert result.builtins == ["read"]
    assert [tool.description for tool in result.custom] == ["FIRST", "SECOND"]


async def test_resolve_tools_raises_the_first_failing_reference_in_order(monkeypatch):
    async def _get_action(*, action_key, **_kwargs):
        if action_key == "FIRST":
            await asyncio.sleep(0.05)
            return None
        # A later reference fails sooner in time; the caller must still see the first.
        raise RuntimeError("later reference failed")

    service = _service(monkeypatch, _get_action)
    with pytest.raises(ActionNotFoundError):
        await service.resolve_tools(
            project_id=uuid4(),
            tools=[_ref("FIRST"), _ref("SECOND")],
        )


async def test_resolve_tools_cancels_later_references_after_a_failure(monkeypatch):
    cancelled = asyncio.Event()

    async def _get_action(*, action_key, **_kwargs):
        if action_key == "FIRST":
            return None
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return _action(action_key)

    service = _service(monkeypatch, _get_action)
    with pytest.raises(ActionNotFoundError):
        await service.resolve_tools(
            project_id=uuid4(),
            tools=[_ref("FIRST"), _ref("SECOND")],
        )
    assert cancelled.is_set()
