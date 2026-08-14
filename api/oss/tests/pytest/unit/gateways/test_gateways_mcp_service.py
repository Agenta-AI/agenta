"""Unit tests for `MCPGatewayService` (specs-wp9.md, tasks-wp9.md).

Every case runs against in-memory mocks — a dict-backed `MCPEndpointsDAOInterface`, a
a stub `ConnectionsService`, a call-logging
`GatewayPolicyService`, and a call-logging `SecretsResolverInterface`. No Postgres, no
HTTP, no real upstream. Organized by the commit sections in tasks-wp9.md:
CRUD delegation, the three-namespace merge, connection-state derivation, the declared
grants surface, and the relay six-step orchestration.
"""

from typing import Dict, List, Optional
from uuid import UUID, uuid4

import pytest

import json

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
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.types import (
    MCPEndpointNotFoundError,
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
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomSecretFormat, SecretKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope


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
async def test_list_endpoints_agenta_entry_has_no_id_and_builtin_namespace():
    service = _service()

    endpoints = await service.list_endpoints(scope=_scope())

    agenta = [e for e in endpoints if e.slug == "tools"]
    assert len(agenta) == 1
    assert agenta[0].id is None
    assert agenta[0].namespace.value == "builtin"


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


# --- connection-state derivation (entities.md §8) ------------------------------------- #


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


# --- grants: declared, not implemented (WP17/WP18) ------------------------------------ #


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
        self._result = result
        self._raise = raise_exc

    async def relay(self, *, route, auth, context, body, headers):
        self.relay_calls += 1
        self.last_auth = auth
        if self._raise is not None:
            raise self._raise
        return self._result or MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=b'{"jsonrpc":"2.0","id":1,"result":{}}',
        )


class MockResolver:
    """Logs every call; returns a canned secret or raises."""

    def __init__(self, *, secret=None, raise_exc=None) -> None:
        self.resolve_calls = 0
        self.last_mode = None
        self._secret = secret
        self._raise = raise_exc

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls += 1
        self.last_mode = mode
        if self._raise is not None:
            raise self._raise
        return self._secret

    async def available_provider_keys(self, *, scope):
        return set()


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

    async def record(self, *, scope, target, decision, outcome):
        self.record_calls.append(
            {"target": target, "decision": decision, "outcome": outcome}
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
) -> MCPGatewayService:
    return MCPGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or MockMCPEndpointsDAO(),
        policy=policy or MockPolicyService(),
        resolver=resolver or MockResolver(),
        upstream_registry=MCPUpstreamRegistry(adapters=adapters),
        connections_service=connections_service or MockConnectionsService(),
    )


@pytest.mark.asyncio
async def test_relay_builtin_agenta_none_scheme_dispatches_without_touching_resolver():
    adapter = MockUpstreamAdapter()
    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(
        resolver=resolver, policy=policy, adapters={"mock": adapter}
    )

    result = await service.relay(
        scope=_scope(),
        namespace="builtin",
        provider="agenta",
        name="tools",
        context=MCPCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert adapter.relay_calls == 1
    assert resolver.resolve_calls == 0
    assert isinstance(adapter.last_auth, MCPDirectAuth)
    assert adapter.last_auth.secret is None
    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 200


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
        context=MCPCallContext(method="initialize"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 0
    assert adapter.relay_calls == 1
    assert isinstance(adapter.last_auth, MCPBrokeredAuth)
    assert adapter.last_auth.connection is connection


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
