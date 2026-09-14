"""The one factory every composition root calls: proves `agenta` rides the
same registry as `slack`/`mock`, built by one function, not a third
hand-built adapters dict."""

from unittest.mock import AsyncMock, patch


from entrypoints.channel_adapters import (
    _resolve_agenta_api_key_project,
    build_channel_adapter_registry,
)
from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter


def test_registry_includes_agenta_beside_slack_and_mock():
    registry = build_channel_adapter_registry()

    assert set(registry.keys()) >= {"slack", "mock", "agenta"}
    assert isinstance(registry.get("agenta"), AgentaAdapter)


async def test_resolve_agenta_api_key_project_returns_none_for_an_invalid_key():
    with patch(
        "entrypoints.channel_adapters.use_api_key",
        new_callable=AsyncMock,
        return_value=False,
    ):
        assert await _resolve_agenta_api_key_project("bad.key") is None


async def test_resolve_agenta_api_key_project_returns_the_projects_id():
    class _FakeApiKey:
        project_id = "11111111-1111-1111-1111-111111111111"

    with patch(
        "entrypoints.channel_adapters.use_api_key",
        new_callable=AsyncMock,
        return_value=_FakeApiKey(),
    ):
        project_id = await _resolve_agenta_api_key_project("good.key")

    assert project_id == "11111111-1111-1111-1111-111111111111"
