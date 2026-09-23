"""The one factory every composition root calls: proves `agenta` rides the
same registry as `slack`/`mock`, built by one function, not a third
hand-built adapters dict."""

from unittest.mock import AsyncMock, patch


from entrypoints.channel_adapters import (
    _resolve_agenta_api_key_project,
    build_channel_adapter_registry,
)
from oss.src.core.access.permissions.types import Permission
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


_PROJECT_ID = "11111111-1111-1111-1111-111111111111"
_USER_ID = "22222222-2222-2222-2222-222222222222"


class _FakeApiKey:
    project_id = _PROJECT_ID
    created_by_id = _USER_ID


def _resolve_with(*, api_key, may_run):
    access = AsyncMock(return_value=may_run)
    return (
        patch(
            "entrypoints.channel_adapters.use_api_key",
            new_callable=AsyncMock,
            return_value=api_key,
        ),
        patch("entrypoints.channel_adapters.check_action_access", access),
        access,
    )


async def test_resolve_agenta_api_key_project_returns_the_projects_id():
    key_patch, access_patch, access = _resolve_with(api_key=_FakeApiKey(), may_run=True)
    with key_patch, access_patch:
        project_id = await _resolve_agenta_api_key_project("good.key")

    assert project_id == _PROJECT_ID
    access.assert_awaited_once_with(
        user_uid=_USER_ID,
        project_id=_PROJECT_ID,
        permission=Permission.RUN_CHANNELS,
    )


async def test_resolve_agenta_api_key_project_refuses_a_key_without_run_channels():
    """A viewer's key is valid for the project but may not run its agents: a
    post on the agenta channel must refuse it like an unknown key."""

    key_patch, access_patch, _ = _resolve_with(api_key=_FakeApiKey(), may_run=False)
    with key_patch, access_patch:
        assert await _resolve_agenta_api_key_project("viewer.key") is None


async def test_resolve_agenta_api_key_project_refuses_a_key_with_no_owner():
    class _OwnerlessApiKey(_FakeApiKey):
        created_by_id = None

    key_patch, access_patch, access = _resolve_with(
        api_key=_OwnerlessApiKey(), may_run=True
    )
    with key_patch, access_patch:
        assert await _resolve_agenta_api_key_project("orphan.key") is None
    access.assert_not_awaited()
