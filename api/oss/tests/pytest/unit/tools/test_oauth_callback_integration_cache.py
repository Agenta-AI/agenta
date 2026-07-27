"""The OAuth callback's best-effort integration-metadata lookup must share the
router's catalog cache instead of re-fetching Composio live on every callback
(house cache pattern: get_cache/set_cache, namespace "tools:catalog:integration",
see ToolsRouter.get_integration)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.gateway.connections.utils import make_oauth_state
from oss.src.core.tools.dtos import ToolCatalogIntegration, ToolProviderKind
from oss.src.utils.env import env


def _fake_connection():
    return SimpleNamespace(
        id=uuid4(),
        provider_key=ToolProviderKind.COMPOSIO,
        integration_key="github",
        slug="github-main",
    )


@pytest.mark.asyncio
async def test_oauth_callback_reuses_cached_integration_across_calls(monkeypatch):
    tools_service = MagicMock()
    tools_service.activate_connection_by_provider_connection_id = AsyncMock(
        return_value=_fake_connection()
    )

    fetch_calls = {"count": 0}

    async def _get_integration(*, provider_key, integration_key):
        fetch_calls["count"] += 1
        return ToolCatalogIntegration(
            key=integration_key,
            name="GitHub",
            logo="https://example.com/logo.png",
            url="https://github.com",
        )

    tools_service.get_integration = AsyncMock(side_effect=_get_integration)

    router = ToolsRouter(tools_service=tools_service)

    # In-memory fake cache standing in for Redis: same get_cache/set_cache contract.
    store: dict = {}

    async def _fake_get_cache(*, project_id, namespace, key, model):
        return store.get((namespace, tuple(sorted(key.items()))))

    async def _fake_set_cache(*, project_id, namespace, key, value, ttl):
        store[(namespace, tuple(sorted(key.items())))] = value

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.get_cache", _fake_get_cache)
    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.set_cache", _fake_set_cache)

    state = make_oauth_state(
        project_id=uuid4(),
        user_id=uuid4(),
        secret_key=env.agenta.crypt_key,
    )
    request = MagicMock()

    first = await router.callback_connection(
        request,
        connected_account_id="ca_1",
        status=None,
        error_message=None,
        state=state,
    )
    second = await router.callback_connection(
        request,
        connected_account_id="ca_1",
        status=None,
        error_message=None,
        state=state,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    # Only the first callback re-fetches Composio; the second is served from cache.
    assert fetch_calls["count"] == 1
