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
    GatewayEndpointConfig,
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
    GrantRef,
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
    LlmCallContext,
    LlmDeploymentKind,
    LlmEndpoint,
    LlmEndpointConfig,
    LlmEndpointCreate,
    LlmEndpointData,
    LlmEndpointEdit,
    LlmEndpointFlags,
    LlmEndpointQuery,
    LlmEndpointRoute,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.types import (
    LlmEndpointNotFoundError,
    LlmModelNotAllowedError,
    LlmUpstreamError,
)
from oss.src.core.gateways.llms.interfaces import (
    LlmEndpointsDAOInterface,
    LlmRelayResult,
    LlmUpstreamInterface,
)

from oss.src.core.gateways.mcps.dtos import (
    McpBrokeredAuth,
    McpCallContext,
    McpDirectAuth,
    McpEndpoint,
    McpEndpointConfig,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointFlags,
    McpEndpointQuery,
    McpGrant,
    McpGrantCreate,
    McpGrantFlags,
    McpGrantQuery,
    McpOAuthData,
    McpResolvedRoute,
    McpToolPolicy,
    McpToolPolicyMode,
)
from oss.src.core.gateways.mcps.types import (
    McpAuthRequiredError,
    McpEndpointNotFoundError,
    McpScopeInsufficientError,
    McpToolNotAllowedError,
    McpUpstreamError,
)
from oss.src.core.gateways.mcps.interfaces import (
    McpEndpointsDAOInterface,
    McpGrantsDAOInterface,
    McpRelayResult,
    McpUpstreamInterface,
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
    config = GatewayEndpointConfig(timeout_seconds=30.0, extra_headers={"x": "y"})
    assert config.timeout_seconds == 30.0


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
    assert GrantRef(endpoint_id=uuid4()).endpoint_id is not None

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
    route = LlmEndpointRoute(base_url="https://api.openai.com/v1")
    config = LlmEndpointConfig(max_output_tokens=4096)
    data = LlmEndpointData(route=route, model_slugs=["gpt-4o"], config=config)
    flags = LlmEndpointFlags()

    endpoint = LlmEndpoint(
        id=uuid4(),
        slug="acme-azure",
        provider_key="azure",
        deployment=LlmDeploymentKind.AZURE,
        data=data,
        flags=flags,
    )
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM

    create = LlmEndpointCreate(
        slug="acme-azure",
        provider_key="azure",
        deployment=LlmDeploymentKind.AZURE,
        data=data,
    )
    assert create.deployment == LlmDeploymentKind.AZURE

    edit = LlmEndpointEdit(id=uuid4(), data=data, flags=flags)
    assert edit.data is data

    query = LlmEndpointQuery(provider_key="azure", deployment=LlmDeploymentKind.AZURE)
    assert query.slug is None

    context = LlmCallContext(model="gpt-4o", stream=True)
    assert context.stream is True

    resolved = LlmResolvedRoute(
        provider_key="azure",
        deployment=LlmDeploymentKind.AZURE,
        model="gpt-4o",
        base_url="https://acme.openai.azure.com",
        config=config,
    )
    assert resolved.model == "gpt-4o"


def test_llm_exceptions():
    not_found = LlmEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="acme-azure"
    )
    assert "acme-azure" in not_found.message

    not_allowed = LlmModelNotAllowedError(
        model="gpt-5", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-azure"
    )
    assert not_allowed.model == "gpt-5"

    upstream = LlmUpstreamError(provider_key="azure", status_code=500, detail="boom")
    assert upstream.status_code == 500


@pytest.mark.asyncio
async def test_llm_relay_result_and_ports():
    async def _body():
        yield b"chunk"

    result = LlmRelayResult(status_code=200, headers={}, body=_body())
    assert {f.name for f in fields(result)} == {
        "status_code",
        "headers",
        "body",
        "usage",
    }

    assert LlmEndpointsDAOInterface.__abstractmethods__ == frozenset(
        {
            "create_endpoint",
            "fetch_endpoint",
            "fetch_endpoint_by_slug",
            "edit_endpoint",
            "delete_endpoint",
            "query_endpoints",
        }
    )
    assert LlmUpstreamInterface.__abstractmethods__ == frozenset(
        {"relay_chat_completion"}
    )


# --- MCP plane --------------------------------------------------------------- #


def test_mcp_dtos():
    tool_policy = McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["search"])
    config = McpEndpointConfig(timeout_seconds=10.0)
    oauth = McpOAuthData(
        resource="https://mcp.acme.com", authorization_server="https://auth.acme.com"
    )
    data = McpEndpointData(
        url="https://mcp.acme.com",
        tool_policy=tool_policy,
        config=config,
        oauth=oauth,
    )
    flags = McpEndpointFlags()

    endpoint = McpEndpoint(
        id=uuid4(),
        slug="acme-notion",
        auth_mode=GatewayAuthScheme.OAUTH,
        data=data,
        flags=flags,
    )
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM

    create = McpEndpointCreate(
        slug="acme-notion", auth_mode=GatewayAuthScheme.OAUTH, data=data
    )
    assert create.data is data

    edit = McpEndpointEdit(id=uuid4(), auth_mode=GatewayAuthScheme.NONE, data=data)
    assert edit.auth_mode == GatewayAuthScheme.NONE

    query = McpEndpointQuery(auth_mode=GatewayAuthScheme.OAUTH)
    assert query.slug is None

    grant_flags = McpGrantFlags()
    grant = McpGrant(
        id=uuid4(), endpoint_id=uuid4(), secret_id=uuid4(), flags=grant_flags
    )
    assert grant.user_id is None

    grant_create = McpGrantCreate(endpoint_id=uuid4(), secret_id=uuid4())
    assert grant_create.flags.is_valid is True

    grant_query = McpGrantQuery(endpoint_id=uuid4())
    assert grant_query.user_id is None

    call_context = McpCallContext(method="tools/call", target="acme-notion")
    assert call_context.method == "tools/call"

    resolved_route = McpResolvedRoute(
        url="https://mcp.acme.com", headers={"x": "y"}, config=config
    )
    assert resolved_route.url == "https://mcp.acme.com"

    direct_auth = McpDirectAuth(
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
    brokered_auth = McpBrokeredAuth(connection=connection)
    assert brokered_auth.connection.integration_key == "notion"


def test_mcp_exceptions():
    not_found = McpEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="my-notion",
        provider="composio",
        integration="notion",
    )
    assert "builtin/composio/notion/my-notion" in not_found.message

    not_allowed = McpToolNotAllowedError(
        tool="search", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-notion"
    )
    assert not_allowed.tool == "search"

    requirement = GatewayConnectionRequirement(
        target="custom/acme-notion", state=GatewayConnectionState.NEEDS_AUTH
    )
    auth_required = McpAuthRequiredError(requirement=requirement)
    assert auth_required.requirement is requirement

    scope_insufficient = McpScopeInsufficientError(
        target="custom/acme-notion", scopes=["notion:write"]
    )
    assert scope_insufficient.scopes == ["notion:write"]

    upstream = McpUpstreamError(target="custom/acme-notion", status_code=502)
    assert upstream.status_code == 502


def test_mcp_relay_result_and_ports():
    result = McpRelayResult(status_code=200, headers={}, body=b"{}")
    assert {f.name for f in fields(result)} == {"status_code", "headers", "body"}

    assert McpEndpointsDAOInterface.__abstractmethods__ == frozenset(
        {
            "create_endpoint",
            "fetch_endpoint",
            "fetch_endpoint_by_slug",
            "edit_endpoint",
            "delete_endpoint",
            "query_endpoints",
        }
    )
    assert McpGrantsDAOInterface.__abstractmethods__ == frozenset(
        {
            "create_grant",
            "fetch_grant",
            "fetch_grant_by_id",
            "update_grant",
            "delete_grant",
            "query_grants",
        }
    )
    assert McpUpstreamInterface.__abstractmethods__ == frozenset({"relay"})


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
            LlmEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            404,
        ),
        (
            McpEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            404,
        ),
        # USE_MOUNTS stands in: the six gateway members are WP3's edit, not the seed's.
        (PolicyDeniedError(permission=Permission.USE_MOUNTS, target="t"), 403),
        (EntitlementDeniedError(key="k", target="t"), 403),
        (
            LlmModelNotAllowedError(
                model="m", namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
            ),
            403,
        ),
        (
            McpToolNotAllowedError(
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
        (McpScopeInsufficientError(target="t", scopes=["a"]), 409),
        (LlmUpstreamError(provider_key="openai", status_code=503), 502),
        (LlmUpstreamError(provider_key="openai", status_code=429), 424),
        (LlmUpstreamError(provider_key="openai"), 424),
        (McpUpstreamError(target="t", status_code=500), 502),
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
        raise McpAuthRequiredError(requirement=requirement)

    with pytest.raises(HTTPException) as excinfo:
        await _handler()
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["requirement"]["target"] == "custom/acme"
