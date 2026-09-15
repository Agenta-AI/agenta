"""Unit tests for `MCPGatewayService`.

Every case runs against in-memory mocks — a dict-backed `MCPEndpointsDAOInterface`, a
a stub `ConnectionsService`, a call-logging
`GatewayPolicyService`, and a call-logging `SecretsResolverInterface`. No Postgres, no
HTTP, or real upstream. Covers CRUD delegation, endpoint listing, connection state, grants,
and relay orchestration.
"""

import json
from types import SimpleNamespace
from typing import Dict, List, Optional
from uuid import UUID, uuid4

import httpx
import pytest

from oss.src.core.gateway.connections.dtos import Connection, ConnectionProviderKind
from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointFlags,
    MCPEndpointQuery,
    MCPEndpointRoute,
    MCPToolFilter,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
    MCPRelayResult,
)
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.providers.composio import ComposioMCPAdapter
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshFailedError
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPConnectionNameTakenError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    SecretOwner,
    SecretOwnerKind,
    PolicyDecision,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import PolicyDeniedError
from oss.src.core.gateways.dtos import GatewayConnectionState
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.secrets.dtos import (
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    MCPStandardProviderDTO,
    OAuthGrantDTO,
    OAuthGrantSettingsDTO,
    SecretResponseDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import (
    CustomSecretFormat,
    SecretKind,
    MCPStandardProviderKind,
)
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env


# --- mocks (this package must not subclass the real Postgres DAO or ConnectionsService) --- #


class MockMCPEndpointsDAO(MCPEndpointsDAOInterface):
    """In-memory endpoint_id -> MCPEndpoint map. Records every call for assertion."""

    def __init__(self) -> None:
        self._by_id: Dict[UUID, MCPEndpoint] = {}
        self.calls: List[str] = []

    async def create_endpoint(
        self, *, project_id, user_id, endpoint
    ) -> Optional[MCPEndpoint]:
        self.calls.append("create_endpoint")
        created = MCPEndpoint(id=uuid4(), **endpoint.model_dump())
        self._by_id[created.id] = created
        return created

    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[MCPEndpoint]:
        self.calls.append("fetch_endpoint")
        return self._by_id.get(endpoint_id)

    async def fetch_endpoint_by_slug(
        self, *, project_id, slug
    ) -> Optional[MCPEndpoint]:
        self.calls.append("fetch_endpoint_by_slug")
        return next((e for e in self._by_id.values() if e.slug == slug), None)

    async def edit_endpoint(
        self, *, project_id, user_id, endpoint
    ) -> Optional[MCPEndpoint]:
        self.calls.append("edit_endpoint")
        existing = self._by_id.get(endpoint.id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={
                "auth_mode": endpoint.auth_mode,
                "secret_id": endpoint.secret_id,
                "data": endpoint.data,
                "flags": endpoint.flags,
            }
        )
        self._by_id[endpoint.id] = updated
        return updated

    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool:
        self.calls.append("delete_endpoint")
        return self._by_id.pop(endpoint_id, None) is not None

    async def query_endpoints(
        self, *, project_id, endpoint=None, windowing=None
    ) -> List[MCPEndpoint]:
        self.calls.append("query_endpoints")
        return list(self._by_id.values())


class MockConnectionsService:
    """In-memory stand-in for `ConnectionsService`; only `query_connections` and
    `get_connection` are called by `MCPGatewayService`."""

    def __init__(self, connections: Optional[List[Connection]] = None) -> None:
        self._connections = connections or []
        self.query_connections_calls: List[dict] = []

    async def query_connections(
        self, *, project_id, provider_key=None, integration_key=None, is_active=True
    ):
        self.query_connections_calls.append(
            {"provider_key": provider_key, "integration_key": integration_key}
        )
        return [
            c
            for c in self._connections
            if (provider_key is None or c.provider_key.value == provider_key)
            and (integration_key is None or c.integration_key == integration_key)
        ]

    async def get_connection(self, *, project_id, connection_id):
        return next((c for c in self._connections if c.id == connection_id), None)


def _connection(
    *,
    slug: str = "my-notion",
    integration_key: str = "notion",
    is_active: bool = True,
    is_valid: bool = True,
) -> Connection:
    return Connection(
        id=uuid4(),
        slug=slug,
        name=slug,
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key=integration_key,
        flags={"is_active": is_active, "is_valid": is_valid},
    )


def _endpoint_create(slug: str = "acme-notion") -> MCPEndpointCreate:
    return MCPEndpointCreate(
        slug=slug,
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://example.com/mcp")
        ),
        flags=MCPEndpointFlags(),
    )


def _service(
    *,
    mcp_endpoints_dao=None,
    connections_service=None,
    resolver=None,
) -> MCPGatewayService:
    from unittest.mock import AsyncMock

    return MCPGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or MockMCPEndpointsDAO(),
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=resolver if resolver is not None else AsyncMock(),
        upstream_registry=MCPUpstreamRegistry(adapters={}),
        connections_service=connections_service or MockConnectionsService(),
    )


# --- CRUD delegation ------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_create_endpoint_delegates_to_dao():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    created = await service.create_endpoint(
        project_id=project_id, user_id=user_id, endpoint=_endpoint_create()
    )

    assert dao.calls == ["create_endpoint"]
    assert created is not None
    assert created.slug == "acme-notion"


@pytest.mark.asyncio
async def test_fetch_endpoint_delegates_to_dao_and_passes_through_result():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    created = await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create()
    )
    dao.calls.clear()

    fetched = await service.fetch_endpoint(project_id=uuid4(), endpoint_id=created.id)

    assert dao.calls == ["fetch_endpoint"]
    assert fetched is created


@pytest.mark.asyncio
async def test_fetch_endpoint_missing_returns_none():
    service = _service()

    fetched = await service.fetch_endpoint(project_id=uuid4(), endpoint_id=uuid4())

    assert fetched is None


@pytest.mark.asyncio
async def test_edit_endpoint_delegates_to_dao():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    created = await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create()
    )
    dao.calls.clear()

    edit = MCPEndpointEdit(
        id=created.id,
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://example.com/mcp-v2")
        ),
    )
    edited = await service.edit_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=edit
    )

    assert dao.calls == ["edit_endpoint"]
    assert edited.data.route.base_url == "https://example.com/mcp-v2"


@pytest.mark.asyncio
async def test_delete_endpoint_delegates_to_dao():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    created = await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create()
    )
    dao.calls.clear()

    deleted = await service.delete_endpoint(project_id=uuid4(), endpoint_id=created.id)

    assert dao.calls == ["delete_endpoint"]
    assert deleted is True


@pytest.mark.asyncio
async def test_query_endpoints_delegates_to_dao_and_returns_its_rows():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create("a")
    )
    await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create("b")
    )
    dao.calls.clear()

    rows = await service.query_endpoints(
        project_id=uuid4(), endpoint=MCPEndpointQuery()
    )

    assert dao.calls == ["query_endpoints"]
    assert {r.slug for r in rows} == {"a", "b"}


# --- list_endpoints: the three-namespace merge --------------------------------------- #


@pytest.mark.asyncio
async def test_list_endpoints_agenta_entry_has_no_id_and_builtin_namespace(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", False)
    service = _service()

    endpoints = await service.list_endpoints(scope=_scope())

    agenta = [e for e in endpoints if e.slug == "run" and e.provider_key == "agenta"]
    assert len(agenta) == 1
    assert agenta[0].id is None
    assert agenta[0].namespace.value == "builtin"
    assert agenta[0].provider_key == "agenta"
    assert agenta[0].data.route.base_url is None


@pytest.mark.asyncio
async def test_list_endpoints_adds_standard_mock_only_with_project_credential(
    monkeypatch,
):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)
    service = _service(resolver=MockResolver(provider_keys={"mock"}))

    endpoints = await service.list_endpoints(scope=_scope())

    standard = [
        endpoint
        for endpoint in endpoints
        if endpoint.namespace.value == "standard" and endpoint.slug == "mock"
    ]
    assert len(standard) == 1
    assert standard[0].id is None
    assert standard[0].data.route.base_url is None


@pytest.mark.asyncio
async def test_list_endpoints_adds_standard_composio_only_with_project_credential():
    service = _service(resolver=MockResolver(provider_keys={"composio"}))

    endpoints = await service.list_endpoints(scope=_scope())

    standard = [
        endpoint
        for endpoint in endpoints
        if endpoint.namespace.value == "standard" and endpoint.slug == "composio"
    ]
    assert len(standard) == 1
    assert standard[0].provider_key == "composio"


@pytest.mark.asyncio
async def test_list_endpoints_omits_generated_mocks_when_disabled(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", False)
    service = _service(resolver=MockResolver(provider_keys={"mock"}))

    endpoints = await service.list_endpoints(scope=_scope())
    assert [(endpoint.provider_key, endpoint.slug) for endpoint in endpoints] == [
        ("agenta", "run")
    ]


@pytest.mark.asyncio
async def test_list_endpoints_builtin_entries_stamp_connection_fields():
    connection = _connection(slug="my-notion", integration_key="notion")
    service = _service(connections_service=MockConnectionsService([connection]))

    endpoints = await service.list_endpoints(scope=_scope())

    # both providers land in `builtin` now, so select composio's by its connection
    builtin = [e for e in endpoints if e.connection_id is not None]
    assert len(builtin) == 1
    assert builtin[0].namespace.value == "builtin"
    assert builtin[0].connection_id == connection.id
    assert builtin[0].provider_key == "composio"
    assert builtin[0].integration_key == "notion"
    assert builtin[0].slug == "my-notion"
    assert builtin[0].id is None  # generated, never a row (D19/D20)


@pytest.mark.asyncio
async def test_list_endpoints_builtin_queries_connections_service_for_composio_only():
    connections_service = MockConnectionsService([_connection()])
    service = _service(connections_service=connections_service)

    await service.list_endpoints(scope=_scope())

    assert connections_service.query_connections_calls == [
        {"provider_key": "composio", "integration_key": None}
    ]


@pytest.mark.asyncio
async def test_list_endpoints_custom_rows_carry_custom_namespace():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create("acme-notion")
    )

    endpoints = await service.list_endpoints(scope=_scope())

    custom = [e for e in endpoints if e.namespace.value == "custom"]
    assert len(custom) == 1
    assert custom[0].slug == "acme-notion"


@pytest.mark.asyncio
async def test_list_endpoints_never_writes_a_generated_entry_to_the_dao():
    dao = MockMCPEndpointsDAO()
    service = _service(
        mcp_endpoints_dao=dao,
        connections_service=MockConnectionsService([_connection()]),
    )

    await service.list_endpoints(scope=_scope())

    assert "create_endpoint" not in dao.calls
    assert "edit_endpoint" not in dao.calls
    assert "delete_endpoint" not in dao.calls


# Connection-state derivation


@pytest.mark.asyncio
async def test_connection_state_none_scheme_is_ready_unconditionally():
    service = _service()
    endpoint = MCPEndpoint(
        id=uuid4(),
        slug="acme",
        auth_mode=MCPAuthScheme.NONE,
        namespace="custom",
        data=MCPEndpointData(route=MCPEndpointRoute(base_url="https://example.com")),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.READY


# Grant behavior


@pytest.mark.asyncio
async def test_connection_state_builtin_with_valid_connection_is_ready():
    connection = _connection(is_active=True, is_valid=True)
    service = _service(connections_service=MockConnectionsService([connection]))
    endpoint = MCPEndpoint(
        slug=connection.slug,
        auth_mode=MCPAuthScheme.OAUTH,
        namespace="builtin",
        connection_id=connection.id,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="composio://composio/notion/my-notion")
        ),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.READY


@pytest.mark.asyncio
async def test_connection_state_builtin_with_invalid_connection_needs_auth():
    connection = _connection(is_active=True, is_valid=False)
    service = _service(connections_service=MockConnectionsService([connection]))
    endpoint = MCPEndpoint(
        slug=connection.slug,
        auth_mode=MCPAuthScheme.OAUTH,
        namespace="builtin",
        connection_id=connection.id,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="composio://composio/notion/my-notion")
        ),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.NEEDS_AUTH


# --- relay: the six-step orchestration ------------------------------------------------- #


class MockUpstreamAdapter:
    """Logs every call; returns a canned result or raises a canned exception."""

    def __init__(self, *, result=None, raise_exc=None) -> None:
        self.relay_calls = 0
        self.last_auth = None
        self.last_route = None
        self._result = result
        self._raise = raise_exc

    async def relay(self, *, route, auth, context, body, headers):
        self.relay_calls += 1
        self.last_auth = auth
        self.last_route = route
        if self._raise is not None:
            raise self._raise
        return self._result or MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=b'{"jsonrpc":"2.0","id":1,"result":{}}',
        )


class MockResolver:
    """Logs every call; returns a canned secret or raises."""

    def __init__(self, *, secret=None, raise_exc=None, provider_keys=None) -> None:
        self.resolve_calls = 0
        self.last_mode = None
        self._secret = secret
        self._raise = raise_exc
        self._provider_keys = provider_keys or set()

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls += 1
        self.last_mode = mode
        if self._raise is not None:
            raise self._raise
        return self._secret

    async def available_provider_keys(self, *, scope):
        return self._provider_keys


class MockPolicyService:
    """Logs authorize()/record() calls in order; the decision is fixed per test."""

    def __init__(self, *, allow: bool = True) -> None:
        self.allow = allow
        self.authorize_calls = 0
        self.record_calls: List[dict] = []

    async def authorize(self, *, scope, permission, target):
        self.authorize_calls += 1
        return PolicyDecision(
            allowed=self.allow,
            permission=permission,
            reason=None if self.allow else "permission_denied",
        )

    async def record(self, *, scope, target, decision, outcome, run_id=None):
        self.record_calls.append(
            {
                "target": target,
                "decision": decision,
                "outcome": outcome,
                "run_id": run_id,
            }
        )


def _resolved_secret(*, user_id: Optional[UUID] = None) -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            kind=SecretKind.CUSTOM_SECRET,
            data=CustomSecretDTO(
                secret=CustomSecretSettingsDTO(
                    format=CustomSecretFormat.TEXT, content="token"
                )
            ),
            header=Header(name="grant"),
        ),
        owner=SecretOwner(
            kind=SecretOwnerKind.USER if user_id else SecretOwnerKind.PROJECT,
            user_id=user_id,
        ),
        origin=SecretOrigin.VAULT,
    )


def _composio_resolved_secret() -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            slug="composio",
            header=Header(name="Composio"),
            kind=SecretKind.PROVIDER_KEY,
            data=MCPStandardProviderDTO(
                kind=MCPStandardProviderKind.COMPOSIO,
                provider=StandardProviderSettingsDTO(key="project-composio-key"),
            ),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _relay_service(
    *,
    mcp_endpoints_dao=None,
    connections_service=None,
    resolver=None,
    policy=None,
    adapters: Dict[str, object],
    oauth_refresher=None,
) -> MCPGatewayService:
    return MCPGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or MockMCPEndpointsDAO(),
        policy=policy or MockPolicyService(),
        resolver=resolver or MockResolver(),
        upstream_registry=MCPUpstreamRegistry(adapters=adapters),
        connections_service=connections_service or MockConnectionsService(),
        oauth_refresher=oauth_refresher,
    )


@pytest.mark.asyncio
async def test_relay_builtin_agenta_none_scheme_dispatches_without_touching_resolver(
    monkeypatch,
):
    from types import SimpleNamespace

    from starlette.requests import Request

    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(resolver=resolver, policy=policy, adapters={})

    class ToolsRouter:
        async def call_tool(self, *, request, body):
            assert body.data.function.name == "agenta.rename_session"
            return SimpleNamespace(
                call=SimpleNamespace(data=SimpleNamespace(content='{"ok":true}'))
            )

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "headers": [],
            "state": {
                "gateway_run_id": "run-1",
                "gateway_tools": [
                    {
                        "name": "rename_session",
                        "call_ref": "agenta.rename_session",
                        "input_schema": {"type": "object"},
                    }
                ],
            },
        }
    )
    service.agenta_tools_router = ToolsRouter()

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        provider="agenta",
        name="run",
        context=MCPCallContext(method="tools/call", target="rename_session"),
        body=(
            b'{"jsonrpc":"2.0","id":1,"method":"tools/call",'
            b'"params":{"name":"rename_session","arguments":{}}}'
        ),
        headers={},
        request=request,
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 0
    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 200


@pytest.mark.asyncio
async def test_relay_builtin_agenta_rejects_unscoped_or_mismatched_tool():
    from starlette.requests import Request

    service = _relay_service(adapters={})
    service.agenta_tools_router = object()
    request = Request({"type": "http", "method": "POST", "headers": [], "state": {}})

    with pytest.raises(ValueError, match="scoped invocation credential"):
        await service.relay(
            scope=_scope(),
            namespace="builtin",
            provider="agenta",
            name="run",
            context=MCPCallContext(method="tools/list"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
            headers={},
            request=request,
        )

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "headers": [],
            "state": {
                "gateway_run_id": "run-1",
                "gateway_tools": [{"name": "allowed", "call_ref": "agenta.allowed"}],
            },
        }
    )
    with pytest.raises(ValueError, match="not available for this invocation"):
        await service.relay(
            scope=_scope(),
            namespace="builtin",
            provider="agenta",
            name="run",
            context=MCPCallContext(method="tools/call", target="other"),
            body=(
                b'{"jsonrpc":"2.0","id":1,"method":"tools/call",'
                b'"params":{"name":"other","arguments":{}}}'
            ),
            headers={},
            request=request,
        )


@pytest.mark.asyncio
async def test_relay_standard_composio_resolves_only_the_project_provider_key():
    adapter = MockUpstreamAdapter()
    resolver = MockResolver(secret=_composio_resolved_secret())
    service = _relay_service(
        resolver=resolver,
        adapters={"composio_standard": adapter},
    )
    scope = _scope()

    result = await service.relay(
        scope=scope,
        namespace="standard",
        provider="composio",
        name="composio",
        context=MCPCallContext(method="tools/list"),
        body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        headers={},
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 1
    assert resolver.last_mode.value == "project_only"
    assert isinstance(adapter.last_auth, MCPDirectAuth)
    assert adapter.last_route.project_id == scope.project_id


@pytest.mark.asyncio
async def test_relay_custom_not_found_raises():
    service = _relay_service(adapters={"http": MockUpstreamAdapter()})

    with pytest.raises(MCPEndpointNotFoundError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="missing",
            context=MCPCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )


async def _custom_endpoint(
    dao: "MockMCPEndpointsDAO", *, tools: Optional[MCPToolFilter] = None
) -> MCPEndpoint:
    return await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme-notion",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp"),
                tools=tools or MCPToolFilter(),
            ),
        ),
    )


@pytest.mark.asyncio
async def test_relay_tool_outside_include_policy_raises_before_resolver_or_adapter():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(allowlist=["a"]))
    adapter = MockUpstreamAdapter()
    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        policy=policy,
        adapters={"http": adapter},
    )

    with pytest.raises(MCPToolNotAllowedError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="b"),
            body=b"{}",
            headers={},
        )

    assert adapter.relay_calls == 0
    assert resolver.resolve_calls == 0
    assert policy.authorize_calls == 0


@pytest.mark.asyncio
async def test_relay_empty_include_policy_refuses_every_tool():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(allowlist=[]))
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={"http": MockUpstreamAdapter()}
    )

    with pytest.raises(MCPToolNotAllowedError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="anything"),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_relay_policy_denial_records_before_raising():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)
    adapter = MockUpstreamAdapter()
    policy = MockPolicyService(allow=False)
    service = _relay_service(
        mcp_endpoints_dao=dao, policy=policy, adapters={"http": adapter}
    )

    with pytest.raises(PolicyDeniedError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
        )

    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 403
    assert adapter.relay_calls == 0


@pytest.mark.asyncio
async def test_relay_builtin_never_touches_resolver_only_connections_service():
    connection = _connection(slug="my-notion", integration_key="notion")
    connections_service = MockConnectionsService([connection])
    adapter = MockUpstreamAdapter()
    resolver = MockResolver()
    service = _relay_service(
        connections_service=connections_service,
        resolver=resolver,
        adapters={"composio": adapter},
    )

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        name="my-notion",
        provider="composio",
        integration="notion",
        context=MCPCallContext(method="server/discover"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 0
    assert adapter.relay_calls == 1
    assert isinstance(adapter.last_auth, MCPBrokeredAuth)
    assert adapter.last_auth.connection is connection


@pytest.mark.asyncio
async def test_relay_builtin_composio_uses_jsonrpc_body_and_brokered_connection():
    connection = _connection(slug="my-notion", integration_key="notion")
    connection.data = {
        "project_id": "project-composio-user",
        "connected_account_id": "ca_notion_123",
    }
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/v3.1/tool_router/session":
            return httpx.Response(
                201,
                json={"mcp": {"url": "https://app.composio.test/mcp/trs_123"}},
            )
        return httpx.Response(
            200,
            content=b'{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
        )

    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(
        connections_service=MockConnectionsService([connection]),
        resolver=resolver,
        policy=policy,
        adapters={
            "composio": ComposioMCPAdapter(
                api_key="platform-key",
                api_url="https://backend.composio.test/api/v3.1",
                transport=httpx.MockTransport(handler),
            )
        },
    )
    body = b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        name="my-notion",
        provider="composio",
        integration="notion",
        context=MCPCallContext(method="tools/list"),
        body=body,
        headers={},
    )

    assert result.status_code == 200
    assert requests[1].content == body
    assert resolver.resolve_calls == 0
    assert policy.record_calls[0]["outcome"].status_code == 200


@pytest.mark.asyncio
async def test_relay_upstream_failure_records_outcome_before_raising():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)
    adapter = MockUpstreamAdapter(
        raise_exc=MCPUpstreamError(target="x", status_code=502)
    )
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao, policy=policy, adapters={"http": adapter}
    )

    with pytest.raises(MCPUpstreamError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )

    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 502


# --- what the audit record says about the call ------------------------------- #


class _RequestWithRunId:
    """The one attribute the relay reads off a request: the run the caller is on.

    A real `Request` cannot be built without an ASGI scope, and the relay reads nothing
    else from it on this path, so standing in for `request.state` is the whole of it.
    """

    def __init__(self, run_id=None) -> None:
        self.state = SimpleNamespace()
        if run_id is not None:
            self.state.gateway_run_id = run_id


@pytest.mark.asyncio
async def test_a_recorded_relay_says_which_method_and_tool_were_called():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        policy=policy,
        adapters={"http": MockUpstreamAdapter()},
    )

    await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
    )

    target = policy.record_calls[0]["target"]
    assert target.method == "tools/call"
    assert target.tool == "echo"


@pytest.mark.asyncio
async def test_every_ending_of_a_relay_is_recorded_with_a_duration():
    """Denial, upstream failure and success are three different endings, and the slow
    ones are the endings a duration is worth having."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)

    denied = MockPolicyService(allow=False)
    with pytest.raises(PolicyDeniedError):
        await _relay_service(
            mcp_endpoints_dao=dao,
            policy=denied,
            adapters={"http": MockUpstreamAdapter()},
        ).relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )

    failed = MockPolicyService()
    with pytest.raises(MCPUpstreamError):
        await _relay_service(
            mcp_endpoints_dao=dao,
            policy=failed,
            adapters={
                "http": MockUpstreamAdapter(
                    raise_exc=MCPUpstreamError(target="x", status_code=502)
                )
            },
        ).relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )

    succeeded = MockPolicyService()
    await _relay_service(
        mcp_endpoints_dao=dao,
        policy=succeeded,
        adapters={"http": MockUpstreamAdapter()},
    ).relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
    )

    for policy in (denied, failed, succeeded):
        assert len(policy.record_calls) == 1
        assert policy.record_calls[0]["outcome"].duration_ms is not None
        assert policy.record_calls[0]["outcome"].duration_ms >= 0


@pytest.mark.asyncio
async def test_a_relay_on_a_run_records_the_run_it_belongs_to():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        policy=policy,
        adapters={"http": MockUpstreamAdapter()},
    )

    await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
        request=_RequestWithRunId("3f9c1d2e4a6b8c0d"),
    )

    assert policy.record_calls[0]["run_id"] == "3f9c1d2e4a6b8c0d"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "request_",
    [None, _RequestWithRunId(), _RequestWithRunId("")],
    ids=["no-request", "no-run-on-the-request", "empty-run"],
)
async def test_a_relay_that_belongs_to_no_run_records_none(request_):
    """A browser or API-key caller holds no run-bound credential. The recorded run must
    then be absent rather than an empty string that reads as a run."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        policy=policy,
        adapters={"http": MockUpstreamAdapter()},
    )

    await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
        request=request_,
    )

    assert policy.record_calls[0]["run_id"] is None


def _tools_list_result(names: List[str]) -> MCPRelayResult:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tools": [{"name": n, "description": n, "inputSchema": {}} for n in names]
        },
    }
    return MCPRelayResult(status_code=200, headers={}, body=json.dumps(body).encode())


@pytest.mark.asyncio
async def test_relay_tools_list_filters_by_include_policy():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(allowlist=["a", "b"]))
    adapter = MockUpstreamAdapter(result=_tools_list_result(["a", "b", "c"]))
    service = _relay_service(mcp_endpoints_dao=dao, adapters={"http": adapter})

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    payload = json.loads(result.body)
    names = {t["name"] for t in payload["result"]["tools"]}
    assert names == {"a", "b"}


@pytest.mark.asyncio
async def test_relay_tools_list_passes_through_untouched_when_policy_is_all():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter())
    adapter = MockUpstreamAdapter(result=_tools_list_result(["a", "b", "c"]))
    service = _relay_service(mcp_endpoints_dao=dao, adapters={"http": adapter})

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    payload = json.loads(result.body)
    names = {t["name"] for t in payload["result"]["tools"]}
    assert names == {"a", "b", "c"}


# Relay scope challenge


async def _oauth_endpoint(dao: "MockMCPEndpointsDAO") -> MCPEndpoint:
    return await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme-notion",
            auth_mode=MCPAuthScheme.OAUTH,
            secret_id=uuid4(),
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp")
            ),
        ),
    )


def _challenge_result(*, www_authenticate: str) -> MCPRelayResult:
    return MCPRelayResult(
        status_code=403,
        headers={"WWW-Authenticate": www_authenticate},
        body=b"",
    )


@pytest.mark.asyncio
async def test_relay_scope_challenge_with_scope_param_raises_with_the_requested_scopes():
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    adapter = MockUpstreamAdapter(
        result=_challenge_result(
            www_authenticate='Bearer error="insufficient_scope", scope="notion:write"'
        )
    )
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        policy=policy,
        adapters={"http": adapter},
    )

    with pytest.raises(MCPScopeInsufficientError) as excinfo:
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    assert excinfo.value.scopes == ["notion:write"]
    assert excinfo.value.endpoint_id == endpoint.id
    assert excinfo.value.target == "custom/acme-notion"
    # Scope challenges are interactions and still record an outcome.
    assert policy.record_calls[-1]["outcome"].status_code == 403


@pytest.mark.asyncio
async def test_relay_scope_challenge_without_scope_param_raises_with_an_empty_list():
    """No `scope=` on the challenge: the dialog re-discovers the offered set instead of
    this refusal guessing which scopes matter (WP18's step 1)."""
    dao = MockMCPEndpointsDAO()
    await _oauth_endpoint(dao)
    adapter = MockUpstreamAdapter(
        result=_challenge_result(www_authenticate='Bearer error="insufficient_scope"')
    )
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        adapters={"http": adapter},
    )

    with pytest.raises(MCPScopeInsufficientError) as excinfo:
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    assert excinfo.value.scopes == []


@pytest.mark.asyncio
async def test_relay_403_without_insufficient_scope_challenge_passes_through_untouched():
    """D16: a plain auth rejection (`invalid_token`, no scope challenge) is the
    upstream's own protocol-level result, not a gateway-authored refusal — it must
    reach the caller byte-for-byte, not be reinterpreted as step-up."""
    dao = MockMCPEndpointsDAO()
    await _oauth_endpoint(dao)
    adapter = MockUpstreamAdapter(
        result=_challenge_result(www_authenticate='Bearer error="invalid_token"')
    )
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        adapters={"http": adapter},
    )

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 403


def _refused_credential_result() -> MCPRelayResult:
    return MCPRelayResult(
        status_code=401,
        headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        body=b'{"error":"invalid_token"}',
    )


@pytest.mark.asyncio
async def test_relay_401_on_an_oauth_connection_asks_for_a_reconnect():
    """A provider can retire a grant this deployment still believes in — the account's
    authorization revoked, the application removed, a token expired earlier than the
    server said. The stored grant looks live, so nothing renews it, and the upstream
    refuses the credential. The caller cannot fix that by retrying."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        policy=policy,
        adapters={"http": MockUpstreamAdapter(result=_refused_credential_result())},
    )

    with pytest.raises(MCPAuthRequiredError) as excinfo:
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    requirement = excinfo.value.requirement
    assert requirement.state == GatewayConnectionState.NEEDS_AUTH
    assert requirement.connect is not None
    assert requirement.connect.endpoint == (
        f"/gateways/mcps/endpoints/{endpoint.id}/connect"
    )
    assert requirement.target == "custom/acme-notion"
    assert policy.record_calls[-1]["outcome"].status_code == 401


@pytest.mark.asyncio
async def test_a_connection_whose_credential_was_refused_stops_reporting_ready():
    """The settings screen reads the stored flag, so a refused credential has to reach
    it; otherwise the connection goes on showing itself connected."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        adapters={"http": MockUpstreamAdapter(result=_refused_credential_result())},
    )
    scope = _scope()

    with pytest.raises(MCPAuthRequiredError):
        await service.relay(
            scope=scope,
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    stored = await dao.fetch_endpoint(
        project_id=scope.project_id, endpoint_id=endpoint.id
    )
    assert stored is not None and stored.flags.is_valid is False


@pytest.mark.asyncio
async def test_relay_401_from_a_none_scheme_connection_passes_through_untouched():
    """A connection with no stored credential has nothing to reconnect. Its 401 is the
    server's own answer about the caller's own authentication and must reach them."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)  # auth_mode=NONE
    service = _relay_service(
        mcp_endpoints_dao=dao,
        adapters={"http": MockUpstreamAdapter(result=_refused_credential_result())},
    )

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 401


@pytest.mark.asyncio
async def test_relay_scope_challenge_ignored_for_a_none_scheme_endpoint():
    """Only an OAuth endpoint can step up — a `none`-scheme endpoint has nothing to
    grant more of, so a 403 from it (however shaped) is pass-through, not step-up."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao)  # auth_mode=NONE
    adapter = MockUpstreamAdapter(
        result=_challenge_result(
            www_authenticate='Bearer error="insufficient_scope", scope="x"'
        )
    )
    service = _relay_service(mcp_endpoints_dao=dao, adapters={"http": adapter})

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 403


# --- OR55: an expired OAuth grant is renewed before the relay, or refused ---------- #


def _grant_secret(*, access_token: str, expires_at: Optional[int]) -> ResolvedSecret:
    """A vault-shaped OAuth grant, as the resolver hands one to the relay."""
    return ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            kind=SecretKind.OAUTH_GRANT,
            data=OAuthGrantDTO(
                grant=OAuthGrantSettingsDTO(
                    server="https://example.com/mcp",
                    access_token=access_token,
                    refresh_token="renewal-handle-1",
                    expires_at=expires_at,
                    scopes=["read"],
                )
            ),
            header=Header(name="grant"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


class _SequenceResolver(MockResolver):
    """Hands out a different secret per call, so a re-read after a refresh is visible."""

    def __init__(self, *, secrets: List[ResolvedSecret]) -> None:
        super().__init__()
        self._secrets = list(secrets)

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls += 1
        self.last_mode = mode
        return self._secrets[min(self.resolve_calls, len(self._secrets)) - 1]


class _StubRefresher:
    def __init__(self, *, failure: Optional[Exception] = None) -> None:
        self.calls: List[str] = []
        # Which connection each refresh was asked for. A relay must renew the grant of
        # the endpoint it resolved, not of whatever else shares that server URL.
        self.endpoint_ids: List[UUID] = []
        self._failure = failure

    async def refresh_grant(self, *, project_id, endpoint_id, server_url) -> None:
        self.calls.append(server_url)
        self.endpoint_ids.append(endpoint_id)
        if self._failure is not None:
            raise self._failure


@pytest.mark.asyncio
async def test_relay_refreshes_an_expired_grant_and_the_call_succeeds():
    """Without the refresh the relay sends the stale token and the upstream 401s, while
    the endpoint goes on reporting READY (OR55)."""
    import time

    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    resolver = _SequenceResolver(
        secrets=[
            _grant_secret(access_token="stale", expires_at=int(time.time()) - 3600),
            _grant_secret(access_token="renewed", expires_at=int(time.time()) + 3600),
        ]
    )
    refresher = _StubRefresher()
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": adapter},
        oauth_refresher=refresher,
    )

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert refresher.calls == ["https://example.com/mcp"]
    # Which grant to renew is the connection, not the URL: several endpoints in one
    # project can name this server and each holds its own.
    assert refresher.endpoint_ids == [endpoint.id]
    # The relay carried the renewed grant, not the one it first read.
    assert adapter.last_auth.secret.secret.data.grant.access_token == "renewed"


@pytest.mark.asyncio
async def test_relay_does_not_refresh_a_grant_that_is_still_live():
    import time

    dao = MockMCPEndpointsDAO()
    await _oauth_endpoint(dao)
    resolver = _SequenceResolver(
        secrets=[_grant_secret(access_token="live", expires_at=int(time.time()) + 3600)]
    )
    refresher = _StubRefresher()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
        oauth_refresher=refresher,
    )

    await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )

    assert refresher.calls == []


@pytest.mark.asyncio
async def test_a_failed_refresh_refuses_the_call_and_the_endpoint_stops_reporting_ready():
    import time

    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    scope = _scope()
    resolver = _SequenceResolver(
        secrets=[
            _grant_secret(access_token="stale", expires_at=int(time.time()) - 3600)
        ]
    )
    refresher = _StubRefresher(
        failure=MCPOAuthRefreshFailedError(server_url="https://example.com/mcp")
    )
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": adapter},
        oauth_refresher=refresher,
    )

    assert (
        await service._connection_state(
            project_id=scope.project_id, user_id=scope.user_id, endpoint=endpoint
        )
        == GatewayConnectionState.READY
    )

    with pytest.raises(MCPAuthRequiredError) as refusal:
        await service.relay(
            scope=scope,
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    requirement = refusal.value.requirement
    assert requirement.state == GatewayConnectionState.NEEDS_AUTH
    assert requirement.connect is not None
    assert str(endpoint.id) in requirement.connect.endpoint
    # Nothing was relayed with a dead token.
    assert adapter.relay_calls == 0
    # And the endpoint now tells the dashboard it needs authorizing again.
    stored = await dao.fetch_endpoint(
        project_id=scope.project_id, endpoint_id=endpoint.id
    )
    assert stored.flags.is_valid is False
    assert (
        await service._connection_state(
            project_id=scope.project_id, user_id=scope.user_id, endpoint=stored
        )
        == GatewayConnectionState.NEEDS_AUTH
    )


@pytest.mark.asyncio
async def test_an_expired_grant_with_no_refresher_wired_refuses_rather_than_relaying():
    import time

    dao = MockMCPEndpointsDAO()
    await _oauth_endpoint(dao)
    resolver = _SequenceResolver(
        secrets=[
            _grant_secret(access_token="stale", expires_at=int(time.time()) - 3600)
        ]
    )
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with pytest.raises(MCPAuthRequiredError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
        )

    assert adapter.relay_calls == 0


# ---------------------------------------------------------------------------
# Brokered builtin endpoints deny by default (OR58)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brokered_builtin_refuses_a_tool_the_connection_did_not_grant():
    """A brokered endpoint spends a credential Agenta holds for the tenant, so its tool
    filter is built explicitly rather than left at the allow-all default. The connection
    grants one tool; the other is refused before the relay, and before any vault read."""
    connection = _connection(slug="my-notion", integration_key="notion")
    connection.data = {"tools": ["NOTION_CREATE_PAGE"]}
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        connections_service=MockConnectionsService([connection]),
        adapters={"composio": adapter},
    )

    with pytest.raises(MCPToolNotAllowedError) as excinfo:
        await service.relay(
            scope=_scope(),
            namespace="builtin",
            name="my-notion",
            provider="composio",
            integration="notion",
            context=MCPCallContext(method="tools/call", target="GMAIL_SEND_EMAIL"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
            headers={},
        )

    assert excinfo.value.tool == "GMAIL_SEND_EMAIL"
    assert adapter.relay_calls == 0

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        name="my-notion",
        provider="composio",
        integration="notion",
        context=MCPCallContext(method="tools/call", target="NOTION_CREATE_PAGE"),
        body=b'{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
        headers={},
    )

    assert result.status_code == 200
    assert adapter.relay_calls == 1


@pytest.mark.asyncio
async def test_brokered_builtin_granting_nothing_allows_nothing():
    """An absent grant is an empty allowlist, not an unlimited one. `MCPToolFilter()`'s
    own default would have been `allowlist=None`, which `allows` reads as allow-all."""
    connection = _connection(slug="my-notion", integration_key="notion")
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        connections_service=MockConnectionsService([connection]),
        adapters={"composio": adapter},
    )

    with pytest.raises(MCPToolNotAllowedError):
        await service.relay(
            scope=_scope(),
            namespace="builtin",
            name="my-notion",
            provider="composio",
            integration="notion",
            context=MCPCallContext(method="tools/call", target="NOTION_CREATE_PAGE"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
            headers={},
        )

    assert adapter.relay_calls == 0


@pytest.mark.asyncio
async def test_brokered_builtin_lists_only_the_tools_it_granted():
    """`tools/list` carries no tool name, so the allowlist has to bite on the way back
    too: an ungranted tool must not be advertised to a run that could not call it."""
    connection = _connection(slug="my-notion", integration_key="notion")
    connection.data = {"tools": ["NOTION_CREATE_PAGE"]}
    listing = MCPRelayResult(
        status_code=200,
        headers={},
        body=json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "tools": [
                        {"name": "NOTION_CREATE_PAGE"},
                        {"name": "GMAIL_SEND_EMAIL"},
                    ]
                },
            }
        ).encode(),
    )
    service = _relay_service(
        connections_service=MockConnectionsService([connection]),
        adapters={"composio": MockUpstreamAdapter(result=listing)},
    )

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        name="my-notion",
        provider="composio",
        integration="notion",
        context=MCPCallContext(method="tools/list"),
        body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        headers={},
    )

    listed = json.loads(result.body)["result"]["tools"]
    assert [entry["name"] for entry in listed] == ["NOTION_CREATE_PAGE"]


# --- a connection's slug is derived, not typed ---------------------------------- #


@pytest.mark.asyncio
async def test_create_derives_a_slug_from_the_display_name_when_none_is_given():
    """A slug is identity and a name is a label. Asking a person to invent the identity
    at setup put both in front of them and invited them to change the wrong one."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)

    created = await service.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            name="Acme, personal",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
            ),
        ),
    )

    assert created is not None
    assert created.slug.startswith("acme-personal-")
    # `get_slug_from_name_and_id` appends the last twelve hex characters of a uuid4.
    assert len(created.slug) == len("acme-personal-") + 12


@pytest.mark.asyncio
async def test_create_falls_back_to_the_server_hostname_when_there_is_no_name():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)

    created = await service.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.io/oauth/mcp")
            ),
        ),
    )

    assert created is not None
    assert created.slug.startswith("mcpacmeio-")


def test_one_display_name_seeds_two_different_slugs():
    """The seed is readability; uniqueness is the suffix.

    A name is free again the moment its connection is deleted, and reusing that name
    must not reuse the slug: agent configurations and grant rows are addressed by the
    identity it stands for, so a second connection seeded from the same name has to get
    a slug of its own.
    """
    from oss.src.core.gateways.mcps.service import derive_endpoint_slug

    create = MCPEndpointCreate(
        name="Acme",
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url="https://mcp.acme.io/")),
    )

    first, second = derive_endpoint_slug(create), derive_endpoint_slug(create)

    assert first != second
    assert first.startswith("acme-") and second.startswith("acme-")


@pytest.mark.asyncio
async def test_create_keeps_a_slug_the_caller_supplied():
    """Existing callers choose their own, and the derived slug must not overwrite it."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)

    created = await service.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=_endpoint_create(slug="chosen-by-the-caller"),
    )

    assert created is not None
    assert created.slug == "chosen-by-the-caller"


# --- a display name is a tool prefix, so it has to be unique -------------------- #


def test_tool_prefix_matches_the_runners_own_normalization():
    """`piMcpToolName` in services/runner/src/extensions/pi-mcp.ts maps everything
    outside [A-Za-z0-9_] to an underscore. If these two ever disagree, the check below
    permits a pair the runner then refuses."""
    from oss.src.core.gateways.mcps.service import tool_prefix

    assert tool_prefix("acme") == "acme"
    assert tool_prefix("Acme Notion") == "Acme_Notion"
    assert tool_prefix("Acme-Notion") == "Acme_Notion"
    assert tool_prefix("acme.prod") == "acme_prod"
    assert tool_prefix("  padded  ") == "padded"
    assert tool_prefix(None) == ""


@pytest.mark.asyncio
async def test_create_refuses_a_display_name_another_connection_already_uses():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    await service.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointCreate(
            slug="first",
            name="Acme",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
            ),
        ),
    )

    with pytest.raises(MCPConnectionNameTakenError):
        await service.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointCreate(
                slug="second",
                name="Acme",
                auth_mode=MCPAuthScheme.NONE,
                data=MCPEndpointData(
                    route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
                ),
            ),
        )


@pytest.mark.asyncio
async def test_create_refuses_two_names_that_render_one_tool_prefix():
    """The reason the comparison is on the rendered prefix. These are different strings
    and the same tool name to a model."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    await service.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointCreate(
            slug="first",
            name="Acme Notion",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
            ),
        ),
    )

    with pytest.raises(MCPConnectionNameTakenError):
        await service.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointCreate(
                slug="second",
                name="Acme-Notion",
                auth_mode=MCPAuthScheme.NONE,
                data=MCPEndpointData(
                    route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
                ),
            ),
        )


@pytest.mark.asyncio
async def test_two_accounts_at_one_url_are_allowed_when_their_names_differ():
    """The whole point of the release. The name check must not be what refuses them."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    created = []
    for name, slug in (("Acme work", "work"), ("Acme personal", "personal")):
        created.append(
            await service.create_endpoint(
                project_id=project_id,
                user_id=user_id,
                endpoint=MCPEndpointCreate(
                    slug=slug,
                    name=name,
                    auth_mode=MCPAuthScheme.NONE,
                    data=MCPEndpointData(
                        route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
                    ),
                ),
            )
        )

    assert all(row is not None for row in created)
    assert {row.slug for row in created} == {"work", "personal"}


@pytest.mark.asyncio
async def test_an_unnamed_connection_is_not_checked():
    """An unnamed connection renders no prefix worth colliding, and a name has never
    been required here."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    for slug in ("first", "second"):
        created = await service.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=_endpoint_create(slug=slug),
        )
        assert created is not None


@pytest.mark.asyncio
async def test_edit_refuses_renaming_onto_another_connections_name():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    for name, slug in (("Acme work", "work"), ("Acme personal", "personal")):
        await service.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointCreate(
                slug=slug,
                name=name,
                auth_mode=MCPAuthScheme.NONE,
                data=MCPEndpointData(
                    route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
                ),
            ),
        )
    personal = next(row for row in dao._by_id.values() if row.slug == "personal")

    with pytest.raises(MCPConnectionNameTakenError):
        await service.edit_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointEdit(
                id=personal.id,
                name="Acme work",
                auth_mode=MCPAuthScheme.NONE,
                data=personal.data,
            ),
        )


@pytest.mark.asyncio
async def test_edit_allows_a_connection_to_keep_the_name_it_already_has():
    """Re-saving without touching the name is not a collision with itself. Every save
    from the settings drawer and every reconnect goes through this path."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()

    created = await service.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointCreate(
            slug="work",
            name="Acme work",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.io/")
            ),
        ),
    )
    assert created is not None

    edited = await service.edit_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointEdit(
            id=created.id,
            name="Acme work",
            auth_mode=MCPAuthScheme.NONE,
            secret_id=uuid4(),
            data=created.data,
        ),
    )

    assert edited is not None
    assert edited.name == "Acme work"
