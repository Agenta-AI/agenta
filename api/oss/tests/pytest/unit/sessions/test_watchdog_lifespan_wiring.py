import asyncio
import importlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_lifespan_wires_the_commands_service_into_the_watchdog(monkeypatch):
    with patch("alembic.script.ScriptDirectory.from_config", return_value=object()):
        routers = importlib.import_module("entrypoints.routers")

    transactions_engine = SimpleNamespace(close=AsyncMock())
    monkeypatch.setattr(routers, "_transactions_engine", transactions_engine)
    monkeypatch.setattr(
        routers, "_analytics_engine", SimpleNamespace(close=AsyncMock())
    )
    monkeypatch.setattr(routers, "_streams_engine", SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr(routers, "_lock_engine", object())
    monkeypatch.setattr(
        routers,
        "_triggers_broker",
        SimpleNamespace(startup=AsyncMock(), shutdown=AsyncMock()),
    )
    monkeypatch.setattr(routers, "_composio_adapters", {})
    monkeypatch.setattr(routers, "_composio_connections_adapters", {})
    monkeypatch.setattr(routers, "_composio_triggers_adapters", {})
    monkeypatch.setattr(routers.env.store, "bucket", None)
    monkeypatch.setattr(routers.env, "composio", SimpleNamespace(enabled=False))
    monkeypatch.setattr(routers, "check_for_new_core_migrations", AsyncMock())
    monkeypatch.setattr(routers, "check_for_new_tracing_migrations", AsyncMock())
    monkeypatch.setattr(routers, "warn_deprecated_env_vars", lambda: None)
    monkeypatch.setattr(routers, "validate_required_env_vars", lambda: None)
    monkeypatch.setattr(routers, "validate_platform_runtime_key", lambda: None)

    watchdog = AsyncMock()
    monkeypatch.setattr(routers, "orphan_sweep_loop", watchdog)
    monkeypatch.setattr(routers, "attachment_sweep_loop", AsyncMock())

    async with routers.lifespan():
        await asyncio.sleep(0)
        watchdog.assert_awaited_once_with(
            transactions_engine,
            routers._lock_engine,
            records_service=routers.records_service,
            watch_publisher=routers._sessions_watch_publisher,
            commands_service=routers.session_commands_service,
        )
        assert routers.session_commands_service is not None
