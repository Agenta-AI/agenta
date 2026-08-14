"""Seed smoke test for the gateways domain (entities.md, wave 0).

Every function/method body in the seed is `raise NotImplementedError`; this test only
proves the declarations import cleanly and every DTO is constructible with representative
values — no DB, no Redis, no API. Behavioural coverage lands with each work package.
"""

from dataclasses import fields
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateway.connections.dtos import Connection, ConnectionProviderKind
from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.shared.dtos import Header

from oss.src.core.gateways.dtos import (
    GatewayAuthScheme,
    GatewayConnectAffordance,
    GatewayConnectionRequirement,
    GatewayConnectionState,
    GatewayEndpointSettings,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.types import GatewaysError

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretMode,
    SecretOwner,
    SecretOwnerKind,
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    GatewayUsage,
    PolicyDecision,
    ProviderKeyRef,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointEdit,
    LLMEndpointFlags,
    LLMEndpointQuery,
    LLMEndpointRoute,
    LLMEndpointSettings,
    LLMModelFilter,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
    LLMModelNotAllowedError,
    LLMUpstreamError,
)
from oss.src.core.gateways.llms.interfaces import (
    LLMEndpointsDAOInterface,
    LLMRelayResult,
    LLMUpstreamInterface,
)

from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPEndpoint,
    MCPEndpointSettings,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointFlags,
    MCPEndpointQuery,
    MCPOAuthData,
    MCPResolvedRoute,
    MCPEndpointRoute,
    MCPToolFilter,
)
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
    MCPRelayResult,
    MCPUpstreamInterface,
)

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions


# --- shared vocabulary (already-done files, exercised transitively) ---------- #


def test_gateway_dtos():
    assert GatewayAuthScheme.NONE.value == "none"
    assert GatewayConnectionState.READY.value == "ready"
    affordance = GatewayConnectAffordance(endpoint="/gateways/mcps/custom/acme/connect")
    requirement = GatewayConnectionRequirement(
        target="custom/acme",
        state=GatewayConnectionState.NEEDS_AUTH,
        connect=affordance,
    )
    assert requirement.connect is affordance
    assert GatewayEndpointNamespace.BUILTIN.value == "builtin"
    settings = GatewayEndpointSettings(timeout_seconds=30.0)
    assert settings.timeout_seconds == 30.0


def test_gateways_error():
    err = GatewaysError()
    assert err.message == "Gateways error"


# --- policy core -------------------------------------------------------------- #


def _standard_secret() -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        kind=SecretKind.PROVIDER_KEY,
        data=StandardProviderDTO(
            kind=StandardProviderKind.OPENAI,
            provider=StandardProviderSettingsDTO(key="sk-test"),
        ),
        header=Header(name="openai"),
    )


def test_policy_dtos():
    assert GatewayPlane.LLM.value == "llm"
    assert SecretMode.USER_OPTIONAL.value == "user_optional"
    owner = SecretOwner(kind=SecretOwnerKind.PROJECT)
    assert owner.user_id is None
    assert SecretOrigin.VAULT.value == "vault"

    assert ProviderKeyRef(provider_key="openai").provider_key == "openai"
    assert BoundSecretRef(secret_id=uuid4()).secret_id is not None

    secret = ResolvedSecret(
        secret=_standard_secret(),
        owner=owner,
        origin=SecretOrigin.LOCAL,
    )
    assert secret.origin == SecretOrigin.LOCAL

    target = GatewayTarget(
        plane=GatewayPlane.LLM,
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="openai",
        model="gpt-4o",
    )
    decision = PolicyDecision(allowed=True, permission=Permission.VIEW_SECRET)
    usage = GatewayUsage(calls=1, input_tokens=10, output_tokens=5)
    outcome = GatewayOutcome(
        status_code=200, usage=usage, owner=owner, origin=SecretOrigin.VAULT
    )
    assert outcome.usage is usage
    assert target.model == "gpt-4o"
    assert decision.allowed is True


def test_policy_exceptions():
    denied = PolicyDeniedError(permission=Permission.VIEW_SECRET, target="custom/acme")
    assert denied.permission == Permission.VIEW_SECRET

    entitlement = EntitlementDeniedError(key="llm_calls", target="builtin/openai")
    assert entitlement.key == "llm_calls"

    not_found = SecretNotFoundError(
        mode=SecretMode.PROJECT_ONLY,
        missing=SecretOwnerKind.PROJECT,
        target="builtin/openai",
    )
    assert not_found.missing == SecretOwnerKind.PROJECT

    invalid = SecretInvalidError(target="custom/acme", detail="refresh failed")
    assert invalid.detail == "refresh failed"

    ceiling = CeilingExceededError(
        ceiling="max_output_tokens", requested=8192, allowed=4096, target="custom/acme"
    )
    assert ceiling.requested == 8192


def test_secret_resolver_interface_is_abstract_with_two_methods():
    assert SecretsResolverInterface.__abstractmethods__ == frozenset(
        {"resolve", "available_provider_keys"}
    )
    with pytest.raises(TypeError):
        SecretsResolverInterface()


# --- LLM plane ------------------------------------------------------------- #


def test_llm_dtos():
    route = LLMEndpointRoute(base_url="https://api.openai.com/v1")
    settings = LLMEndpointSettings(max_output_tokens=4096)
    data = LLMEndpointData(
        route=route, models=LLMModelFilter(allowlist=["gpt-4o"]), settings=settings
    )
    flags = LLMEndpointFlags()

    endpoint = LLMEndpoint(
        id=uuid4(),
        slug="acme-azure",
        provider_key="azure",
        deployment_kind=LLMDeploymentKind.AZURE,
        data=data,
        flags=flags,
    )
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM

    create = LLMEndpointCreate(
        slug="acme-azure",
        provider_key="azure",
        deployment_kind=LLMDeploymentKind.AZURE,
        data=data,
    )
    assert create.deployment_kind == LLMDeploymentKind.AZURE

    edit = LLMEndpointEdit(id=uuid4(), data=data, flags=flags)
    assert edit.data is data

    query = LLMEndpointQuery(
        provider_key="azure", deployment_kind=LLMDeploymentKind.AZURE
    )
    assert query.slug is None

    context = LLMCallContext(model="gpt-4o", stream=True)
    assert context.stream is True

    resolved = LLMResolvedRoute(
        provider_key="azure",
        deployment_kind=LLMDeploymentKind.AZURE,
        model="gpt-4o",
        base_url="https://acme.openai.azure.com",
        settings=settings,
    )
    assert resolved.model == "gpt-4o"


def test_llm_exceptions():
    not_found = LLMEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="acme-azure"
    )
    assert "acme-azure" in not_found.message

    not_allowed = LLMModelNotAllowedError(
        model="gpt-5", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-azure"
    )
    assert not_allowed.model == "gpt-5"

    upstream = LLMUpstreamError(provider_key="azure", status_code=500, detail="boom")
    assert upstream.status_code == 500


@pytest.mark.asyncio
async def test_llm_relay_result_and_ports():
    async def _body():
        yield b"chunk"

    result = LLMRelayResult(status_code=200, headers={}, body=_body())
    assert {f.name for f in fields(result)} == {
        "status_code",
        "headers",
        "body",
        "usage",
    }

    assert LLMEndpointsDAOInterface.__abstractmethods__ == frozenset(
        {
            "create_endpoint",
            "fetch_endpoint",
            "fetch_endpoint_by_slug",
            "edit_endpoint",
            "delete_endpoint",
            "query_endpoints",
        }
    )
    assert LLMUpstreamInterface.__abstractmethods__ == frozenset(
        {"relay_chat_completion"}
    )


# --- MCP plane --------------------------------------------------------------- #


def test_mcp_dtos():
    tools = MCPToolFilter(allowlist=["search"])
    settings = MCPEndpointSettings(timeout_seconds=10.0)
    oauth = MCPOAuthData(
        resource="https://mcp.acme.com", authorization_server="https://auth.acme.com"
    )
    data = MCPEndpointData(
        route=MCPEndpointRoute(base_url="https://mcp.acme.com"),
        tools=tools,
        settings=settings,
        oauth=oauth,
    )
    flags = MCPEndpointFlags()

    endpoint = MCPEndpoint(
        id=uuid4(),
        slug="acme-notion",
        auth_mode=GatewayAuthScheme.OAUTH,
        data=data,
        flags=flags,
    )
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM

    create = MCPEndpointCreate(
        slug="acme-notion", auth_mode=GatewayAuthScheme.OAUTH, data=data
    )
    assert create.data is data

    edit = MCPEndpointEdit(id=uuid4(), auth_mode=GatewayAuthScheme.NONE, data=data)
    assert edit.auth_mode == GatewayAuthScheme.NONE

    query = MCPEndpointQuery(auth_mode=GatewayAuthScheme.OAUTH)
    assert query.slug is None

    call_context = MCPCallContext(method="tools/call", target="acme-notion")
    assert call_context.method == "tools/call"

    resolved_route = MCPResolvedRoute(
        url="https://mcp.acme.com", headers={"x": "y"}, settings=settings
    )
    assert resolved_route.url == "https://mcp.acme.com"

    direct_auth = MCPDirectAuth(
        secret=ResolvedSecret(
            secret=_standard_secret(),
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
            origin=SecretOrigin.VAULT,
        )
    )
    assert direct_auth.secret is not None

    connection = Connection(
        id=uuid4(),
        slug="my-notion",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="notion",
    )
    brokered_auth = MCPBrokeredAuth(connection=connection)
    assert brokered_auth.connection.integration_key == "notion"


def test_mcp_exceptions():
    not_found = MCPEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="my-notion",
        provider="composio",
        integration="notion",
    )
    assert "builtin/composio/notion/my-notion" in not_found.message

    not_allowed = MCPToolNotAllowedError(
        tool="search", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-notion"
    )
    assert not_allowed.tool == "search"

    requirement = GatewayConnectionRequirement(
        target="custom/acme-notion", state=GatewayConnectionState.NEEDS_AUTH
    )
    auth_required = MCPAuthRequiredError(requirement=requirement)
    assert auth_required.requirement is requirement

    scope_insufficient = MCPScopeInsufficientError(
        target="custom/acme-notion", scopes=["notion:write"]
    )
    assert scope_insufficient.scopes == ["notion:write"]

    upstream = MCPUpstreamError(target="custom/acme-notion", status_code=502)
    assert upstream.status_code == 502


def test_mcp_relay_result_and_ports():
    result = MCPRelayResult(status_code=200, headers={}, body=b"{}")
    assert {f.name for f in fields(result)} == {"status_code", "headers", "body"}

    assert MCPEndpointsDAOInterface.__abstractmethods__ == frozenset(
        {
            "create_endpoint",
            "fetch_endpoint",
            "fetch_endpoint_by_slug",
            "edit_endpoint",
            "delete_endpoint",
            "query_endpoints",
        }
    )
    assert MCPUpstreamInterface.__abstractmethods__ == frozenset({"relay"})


# --- API boundary -------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_handle_gateway_exceptions_passes_through():
    @handle_gateway_exceptions()
    async def _handler():
        return "ok"

    assert await _handler() == "ok"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raised, expected_status",
    [
        (
            LLMEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            404,
        ),
        (
            MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            404,
        ),
        # USE_MOUNTS stands in: the six gateway members are WP3's edit, not the seed's.
        (PolicyDeniedError(permission=Permission.USE_MOUNTS, target="t"), 403),
        (EntitlementDeniedError(key="k", target="t"), 403),
        (
            LLMModelNotAllowedError(
                model="m", namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            403,
        ),
        (
            MCPToolNotAllowedError(
                tool="t", namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            403,
        ),
        (
            CeilingExceededError(
                ceiling="max_output_tokens", requested=100, allowed=10, target="t"
            ),
            400,
        ),
        (SecretInvalidError(target="t"), 409),
        (MCPScopeInsufficientError(target="t", scopes=["a"]), 409),
        (LLMUpstreamError(provider_key="openai", status_code=503), 502),
        (LLMUpstreamError(provider_key="openai", status_code=429), 424),
        (LLMUpstreamError(provider_key="openai"), 424),
        (MCPUpstreamError(target="t", status_code=500), 502),
    ],
)
async def test_handle_gateway_exceptions_mapping(raised, expected_status):
    @handle_gateway_exceptions()
    async def _handler():
        raise raised

    with pytest.raises(HTTPException) as excinfo:
        await _handler()
    assert excinfo.value.status_code == expected_status


@pytest.mark.asyncio
async def test_ceiling_denial_names_all_three_numbers():
    """D25: rejection is tolerable only because the denial says what to retry with."""

    @handle_gateway_exceptions()
    async def _handler():
        raise CeilingExceededError(
            ceiling="max_output_tokens", requested=4096, allowed=1024, target="t"
        )

    with pytest.raises(HTTPException) as excinfo:
        await _handler()
    detail = excinfo.value.detail
    assert detail["ceiling"] == "max_output_tokens"
    assert detail["requested"] == 4096
    assert detail["allowed"] == 1024


@pytest.mark.asyncio
async def test_auth_required_carries_the_connect_affordance():
    """D17: an interaction, not a failure — the 409 must carry the requirement."""
    requirement = GatewayConnectionRequirement(
        target="custom/acme",
        state=GatewayConnectionState.NEEDS_AUTH,
        connect=GatewayConnectAffordance(
            endpoint="/gateways/mcps/custom/acme/connect",
        ),
    )

    @handle_gateway_exceptions()
    async def _handler():
        raise MCPAuthRequiredError(requirement=requirement)

    with pytest.raises(HTTPException) as excinfo:
        await _handler()
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["requirement"]["target"] == "custom/acme"
