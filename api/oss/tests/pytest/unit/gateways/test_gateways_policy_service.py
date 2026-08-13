"""Unit tests for GatewayPolicyService (specs-wp3.md).

`check_action_access` is mocked at the module boundary
(`oss.src.core.gateways.policy.service.check_action_access`) — it is
`authorize()`'s only dependency. No entitlement check exists (D29), so there is
nothing else to mock and no "entitlement denied" arm to exercise here.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.access.permissions.types import DefaultRole, Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    PolicyDecision,
)
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.utils.context import AuthScope


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _target() -> GatewayTarget:
    return GatewayTarget(
        plane=GatewayPlane.LLM,
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="openai",
        model="gpt-4o",
    )


def _service() -> GatewayPolicyService:
    return GatewayPolicyService(resolver=AsyncMock())


@pytest.mark.asyncio
async def test_authorize_allows_when_check_action_access_true(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.policy.service.check_action_access",
        AsyncMock(return_value=True),
    )

    decision = await _service().authorize(
        scope=_scope(), permission=Permission.USE_LLM_ENDPOINTS, target=_target()
    )

    assert decision == PolicyDecision(
        allowed=True, permission=Permission.USE_LLM_ENDPOINTS, reason=None
    )


@pytest.mark.asyncio
async def test_authorize_denies_when_check_action_access_false(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.policy.service.check_action_access",
        AsyncMock(return_value=False),
    )

    decision = await _service().authorize(
        scope=_scope(), permission=Permission.USE_LLM_ENDPOINTS, target=_target()
    )

    assert decision.allowed is False
    assert decision.reason == "permission_denied"


@pytest.mark.asyncio
async def test_authorize_propagates_when_check_action_access_raises(monkeypatch):
    """Fail-closed by construction: no try/except swallows this into
    allowed=True — the exception is left to propagate uncaught."""

    async def _raise(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "oss.src.core.gateways.policy.service.check_action_access", _raise
    )

    with pytest.raises(RuntimeError, match="boom"):
        await _service().authorize(
            scope=_scope(), permission=Permission.USE_LLM_ENDPOINTS, target=_target()
        )


@pytest.mark.asyncio
async def test_record_is_a_safe_noop(monkeypatch):
    publish = AsyncMock()
    monkeypatch.setattr("oss.src.core.events.streaming.publish_event", publish)

    result = await _service().record(
        scope=_scope(),
        target=_target(),
        decision=PolicyDecision(
            allowed=True, permission=Permission.USE_LLM_ENDPOINTS, reason=None
        ),
        outcome=GatewayOutcome(status_code=200),
    )

    assert result is None
    publish.assert_not_called()


# --- role wiring (entities.md §9) -------------------------------------------- #


def test_viewer_gains_view_llm_and_mcp_endpoints():
    permissions = Permission.default_permissions(DefaultRole.VIEWER)
    assert Permission.VIEW_LLM_ENDPOINTS in permissions
    assert Permission.VIEW_MCP_ENDPOINTS in permissions
    assert Permission.USE_LLM_ENDPOINTS not in permissions
    assert Permission.EDIT_LLM_ENDPOINTS not in permissions


def test_annotator_gains_use_llm_and_mcp_endpoints_on_top_of_viewer():
    permissions = Permission.default_permissions(DefaultRole.ANNOTATOR)
    assert Permission.VIEW_LLM_ENDPOINTS in permissions
    assert Permission.VIEW_MCP_ENDPOINTS in permissions
    assert Permission.USE_LLM_ENDPOINTS in permissions
    assert Permission.USE_MCP_ENDPOINTS in permissions
    assert Permission.EDIT_LLM_ENDPOINTS not in permissions
    assert Permission.EDIT_MCP_ENDPOINTS not in permissions


def test_editor_gains_edit_llm_and_mcp_endpoints_on_top_of_annotator():
    permissions = Permission.default_permissions(DefaultRole.EDITOR)
    for member in (
        Permission.VIEW_LLM_ENDPOINTS,
        Permission.VIEW_MCP_ENDPOINTS,
        Permission.USE_LLM_ENDPOINTS,
        Permission.USE_MCP_ENDPOINTS,
        Permission.EDIT_LLM_ENDPOINTS,
        Permission.EDIT_MCP_ENDPOINTS,
    ):
        assert member in permissions


@pytest.mark.parametrize(
    "role",
    [DefaultRole.DEVELOPER, DefaultRole.ADMIN, DefaultRole.OWNER],
)
def test_superset_roles_propagate_all_six_members(role):
    permissions = Permission.default_permissions(role)
    for member in (
        Permission.VIEW_LLM_ENDPOINTS,
        Permission.VIEW_MCP_ENDPOINTS,
        Permission.USE_LLM_ENDPOINTS,
        Permission.USE_MCP_ENDPOINTS,
        Permission.EDIT_LLM_ENDPOINTS,
        Permission.EDIT_MCP_ENDPOINTS,
    ):
        assert member in permissions
