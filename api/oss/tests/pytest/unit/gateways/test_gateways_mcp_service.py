"""Unit tests for `McpGatewayService` (specs-wp9.md, tasks-wp9.md).

Every case runs against in-memory mocks — a dict-backed `McpEndpointsDAOInterface`, a
dict-backed `McpGrantsDAOInterface`, a stub `ConnectionsService`, a call-logging
`GatewayPolicyService`, and a call-logging `CredentialResolverInterface`. No Postgres, no
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
    McpBrokeredAuth,
    McpCallContext,
    McpDirectAuth,
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointFlags,
    McpEndpointQuery,
    McpGrant,
    McpGrantFlags,
    McpToolPolicy,
    McpToolPolicyMode,
)
from oss.src.core.gateways.mcps.interfaces import (
    McpEndpointsDAOInterface,
    McpRelayResult,
)
from oss.src.core.gateways.mcps.registry import McpUpstreamRegistry
from oss.src.core.gateways.mcps.service import McpGatewayService
from oss.src.core.gateways.mcps.types import (
    McpEndpointNotFoundError,
    McpToolNotAllowedError,
    McpUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    CredentialMode,
    CredentialOwner,
    CredentialOwnerKind,
    PolicyDecision,
    ResolvedCredential,
    SecretOrigin,
)
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import PolicyDeniedError
from oss.src.core.gateways.dtos import GatewayAuthScheme, GatewayConnectionState
from oss.src.core.secrets.dtos import (
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomSecretFormat, SecretKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope


# --- mocks (this package must not subclass the real Postgres DAO or ConnectionsService) --- #


class MockMcpEndpointsDAO(McpEndpointsDAOInterface):
    """In-memory endpoint_id -> McpEndpoint map. Records every call for assertion."""

    def __init__(self) -> None:
        self._by_id: Dict[UUID, McpEndpoint] = {}
        self.calls: List[str] = []

    async def create_endpoint(
        self, *, project_id, user_id, endpoint
    ) -> Optional[McpEndpoint]:
        self.calls.append("create_endpoint")
        created = McpEndpoint(id=uuid4(), **endpoint.model_dump())
        self._by_id[created.id] = created
        return created

    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[McpEndpoint]:
        self.calls.append("fetch_endpoint")
        return self._by_id.get(endpoint_id)

    async def fetch_endpoint_by_slug(
        self, *, project_id, slug
    ) -> Optional[McpEndpoint]:
        self.calls.append("fetch_endpoint_by_slug")
        return next((e for e in self._by_id.values() if e.slug == slug), None)

    async def edit_endpoint(
        self, *, project_id, user_id, endpoint
    ) -> Optional[McpEndpoint]:
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
    ) -> List[McpEndpoint]:
        self.calls.append("query_endpoints")
        return list(self._by_id.values())


class MockMcpGrantsDAO:
    """In-memory (endpoint_id, user_id) -> McpGrant map; only the two verbs the
    service touches in wave 1."""

    def __init__(self, grants: Optional[List[McpGrant]] = None) -> None:
        self._by_key: Dict[tuple, McpGrant] = {
            (g.endpoint_id, g.user_id): g for g in grants or []
        }

    async def fetch_grant(self, *, project_id, endpoint_id, user_id):
        return self._by_key.get((endpoint_id, user_id))


class MockConnectionsService:
    """In-memory stand-in for `ConnectionsService`; only `query_connections` and
    `get_connection` are called by `McpGatewayService`."""

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


def _endpoint_create(slug: str = "acme-notion") -> McpEndpointCreate:
    return McpEndpointCreate(
        slug=slug,
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://example.com/mcp"),
        flags=McpEndpointFlags(),
    )


def _service(
    *,
    mcp_endpoints_dao=None,
    mcp_grants_dao=None,
    connections_service=None,
    resolver=None,
) -> McpGatewayService:
    from unittest.mock import AsyncMock

    return McpGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or MockMcpEndpointsDAO(),
        mcp_grants_dao=mcp_grants_dao or MockMcpGrantsDAO(),
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=resolver if resolver is not None else AsyncMock(),
        upstream_registry=McpUpstreamRegistry(adapters={}),
        connections_service=connections_service or MockConnectionsService(),
    )


# --- CRUD delegation ------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_create_endpoint_delegates_to_dao():
    dao = MockMcpEndpointsDAO()
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
    dao = MockMcpEndpointsDAO()
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
    dao = MockMcpEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    created = await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create()
    )
    dao.calls.clear()

    edit = McpEndpointEdit(
        id=created.id,
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://example.com/mcp-v2"),
    )
    edited = await service.edit_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=edit
    )

    assert dao.calls == ["edit_endpoint"]
    assert edited.data.url == "https://example.com/mcp-v2"


@pytest.mark.asyncio
async def test_delete_endpoint_delegates_to_dao():
    dao = MockMcpEndpointsDAO()
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
    dao = MockMcpEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create("a")
    )
    await service.create_endpoint(
        project_id=uuid4(), user_id=uuid4(), endpoint=_endpoint_create("b")
    )
    dao.calls.clear()

    rows = await service.query_endpoints(
        project_id=uuid4(), endpoint=McpEndpointQuery()
    )

    assert dao.calls == ["query_endpoints"]
    assert {r.slug for r in rows} == {"a", "b"}


# --- list_endpoints: the three-namespace merge --------------------------------------- #


@pytest.mark.asyncio
async def test_list_endpoints_agenta_entry_has_no_id_and_agenta_namespace():
    service = _service()

    endpoints = await service.list_endpoints(scope=_scope())

    agenta = [e for e in endpoints if e.namespace.value == "agenta"]
    assert len(agenta) == 1
    assert agenta[0].id is None
    assert agenta[0].slug == "tools"


@pytest.mark.asyncio
async def test_list_endpoints_builtin_entries_stamp_connection_fields():
    connection = _connection(slug="my-notion", integration_key="notion")
    service = _service(connections_service=MockConnectionsService([connection]))

    endpoints = await service.list_endpoints(scope=_scope())

    builtin = [e for e in endpoints if e.namespace.value == "builtin"]
    assert len(builtin) == 1
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
    dao = MockMcpEndpointsDAO()
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
    dao = MockMcpEndpointsDAO()
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
    endpoint = McpEndpoint(
        id=uuid4(),
        slug="acme",
        auth_mode=GatewayAuthScheme.NONE,
        namespace="custom",
        data=McpEndpointData(url="https://example.com"),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.READY


@pytest.mark.asyncio
async def test_connection_state_custom_with_valid_grant_is_ready():
    endpoint_id = uuid4()
    grant = McpGrant(
        id=uuid4(),
        endpoint_id=endpoint_id,
        user_id=None,
        secret_id=uuid4(),
        flags=McpGrantFlags(is_valid=True),
    )
    service = _service(mcp_grants_dao=MockMcpGrantsDAO([grant]))
    endpoint = McpEndpoint(
        id=endpoint_id,
        slug="acme",
        auth_mode=GatewayAuthScheme.OAUTH,
        namespace="custom",
        data=McpEndpointData(url="https://example.com"),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=None, endpoint=endpoint
    )

    assert state == GatewayConnectionState.READY


@pytest.mark.asyncio
async def test_connection_state_custom_with_no_grant_needs_auth():
    service = _service(mcp_grants_dao=MockMcpGrantsDAO())
    endpoint = McpEndpoint(
        id=uuid4(),
        slug="acme",
        auth_mode=GatewayAuthScheme.OAUTH,
        namespace="custom",
        data=McpEndpointData(url="https://example.com"),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.NEEDS_AUTH


# --- grants: declared, not implemented (WP17/WP18) ------------------------------------ #


@pytest.mark.asyncio
async def test_connect_endpoint_raises_not_implemented():
    service = _service()
    with pytest.raises(NotImplementedError):
        await service.connect_endpoint(
            project_id=uuid4(), user_id=uuid4(), endpoint_id=uuid4(), scopes=[]
        )


@pytest.mark.asyncio
async def test_complete_connect_raises_not_implemented():
    service = _service()
    with pytest.raises(NotImplementedError):
        await service.complete_connect(state="x", payload={})


@pytest.mark.asyncio
async def test_revoke_grant_raises_not_implemented():
    service = _service()
    with pytest.raises(NotImplementedError):
        await service.revoke_grant(project_id=uuid4(), grant_id=uuid4())


@pytest.mark.asyncio
async def test_query_grants_raises_not_implemented():
    service = _service()
    with pytest.raises(NotImplementedError):
        await service.query_grants(project_id=uuid4())


@pytest.mark.asyncio
async def test_connection_state_builtin_with_valid_connection_is_ready():
    connection = _connection(is_active=True, is_valid=True)
    service = _service(connections_service=MockConnectionsService([connection]))
    endpoint = McpEndpoint(
        slug=connection.slug,
        auth_mode=GatewayAuthScheme.OAUTH,
        namespace="builtin",
        connection_id=connection.id,
        data=McpEndpointData(url="composio://composio/notion/my-notion"),
    )

    state = await service._connection_state(
        project_id=uuid4(), user_id=uuid4(), endpoint=endpoint
    )

    assert state == GatewayConnectionState.READY


@pytest.mark.asyncio
async def test_connection_state_builtin_with_invalid_connection_needs_auth():
    connection = _connection(is_active=True, is_valid=False)
    service = _service(connections_service=MockConnectionsService([connection]))
    endpoint = McpEndpoint(
        slug=connection.slug,
        auth_mode=GatewayAuthScheme.OAUTH,
        namespace="builtin",
        connection_id=connection.id,
        data=McpEndpointData(url="composio://composio/notion/my-notion"),
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
        return self._result or McpRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=b'{"jsonrpc":"2.0","id":1,"result":{}}',
        )


class MockResolver:
    """Logs every call; returns a canned credential or raises."""

    def __init__(self, *, credential=None, raise_exc=None) -> None:
        self.resolve_calls = 0
        self.last_mode = None
        self._credential = credential
        self._raise = raise_exc

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls += 1
        self.last_mode = mode
        if self._raise is not None:
            raise self._raise
        return self._credential

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


def _resolved_credential(*, user_id: Optional[UUID] = None) -> ResolvedCredential:
    return ResolvedCredential(
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
        owner=CredentialOwner(
            kind=CredentialOwnerKind.USER if user_id else CredentialOwnerKind.PROJECT,
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
) -> McpGatewayService:
    return McpGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or MockMcpEndpointsDAO(),
        mcp_grants_dao=MockMcpGrantsDAO(),
        policy=policy or MockPolicyService(),
        resolver=resolver or MockResolver(),
        upstream_registry=McpUpstreamRegistry(adapters=adapters),
        connections_service=connections_service or MockConnectionsService(),
    )


@pytest.mark.asyncio
async def test_relay_agenta_none_scheme_dispatches_without_touching_resolver():
    adapter = MockUpstreamAdapter()
    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(
        resolver=resolver, policy=policy, adapters={"mock": adapter}
    )

    result = await service.relay(
        scope=_scope(),
        namespace="agenta",
        name="tools",
        context=McpCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert adapter.relay_calls == 1
    assert resolver.resolve_calls == 0
    assert isinstance(adapter.last_auth, McpDirectAuth)
    assert adapter.last_auth.credential is None
    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 200


@pytest.mark.asyncio
async def test_relay_custom_not_found_raises():
    service = _relay_service(adapters={"http": MockUpstreamAdapter()})

    with pytest.raises(McpEndpointNotFoundError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="missing",
            context=McpCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )


async def _custom_endpoint(
    dao: "MockMcpEndpointsDAO", *, tool_policy: Optional[McpToolPolicy] = None
) -> McpEndpoint:
    return await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=McpEndpointCreate(
            slug="acme-notion",
            auth_mode=GatewayAuthScheme.NONE,
            data=McpEndpointData(
                url="https://example.com/mcp",
                tool_policy=tool_policy or McpToolPolicy(),
            ),
        ),
    )


@pytest.mark.asyncio
async def test_relay_tool_outside_include_policy_raises_before_resolver_or_adapter():
    dao = MockMcpEndpointsDAO()
    await _custom_endpoint(
        dao, tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["a"])
    )
    adapter = MockUpstreamAdapter()
    resolver = MockResolver()
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        policy=policy,
        adapters={"http": adapter},
    )

    with pytest.raises(McpToolNotAllowedError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=McpCallContext(method="tools/call", target="b"),
            body=b"{}",
            headers={},
        )

    assert adapter.relay_calls == 0
    assert resolver.resolve_calls == 0
    assert policy.authorize_calls == 0


@pytest.mark.asyncio
async def test_relay_empty_include_policy_refuses_every_tool():
    dao = MockMcpEndpointsDAO()
    await _custom_endpoint(
        dao, tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=[])
    )
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={"http": MockUpstreamAdapter()}
    )

    with pytest.raises(McpToolNotAllowedError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=McpCallContext(method="tools/call", target="anything"),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_relay_policy_denial_records_before_raising():
    dao = MockMcpEndpointsDAO()
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
            context=McpCallContext(method="tools/list"),
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
        context=McpCallContext(method="initialize"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 0
    assert adapter.relay_calls == 1
    assert isinstance(adapter.last_auth, McpBrokeredAuth)
    assert adapter.last_auth.connection is connection


@pytest.mark.asyncio
async def test_relay_custom_oauth_resolves_via_resolver_with_user_optional_mode():
    dao = MockMcpEndpointsDAO()
    endpoint = await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=McpEndpointCreate(
            slug="acme-oauth",
            auth_mode=GatewayAuthScheme.OAUTH,
            data=McpEndpointData(url="https://example.com/mcp"),
        ),
    )
    credential = _resolved_credential()
    resolver = MockResolver(credential=credential)
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-oauth",
        context=McpCallContext(method="tools/call", target="echo"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert resolver.resolve_calls == 1
    assert resolver.last_mode == CredentialMode.USER_OPTIONAL
    assert isinstance(adapter.last_auth, McpDirectAuth)
    assert adapter.last_auth.credential is credential
    assert endpoint.id is not None


@pytest.mark.asyncio
async def test_relay_upstream_failure_records_outcome_before_raising():
    dao = MockMcpEndpointsDAO()
    await _custom_endpoint(dao)
    adapter = MockUpstreamAdapter(
        raise_exc=McpUpstreamError(target="x", status_code=502)
    )
    policy = MockPolicyService()
    service = _relay_service(
        mcp_endpoints_dao=dao, policy=policy, adapters={"http": adapter}
    )

    with pytest.raises(McpUpstreamError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=McpCallContext(method="tools/call", target="echo"),
            body=b"{}",
            headers={},
        )

    assert len(policy.record_calls) == 1
    assert policy.record_calls[0]["outcome"].status_code == 502


def _tools_list_result(names: List[str]) -> McpRelayResult:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tools": [{"name": n, "description": n, "inputSchema": {}} for n in names]
        },
    }
    return McpRelayResult(status_code=200, headers={}, body=json.dumps(body).encode())


@pytest.mark.asyncio
async def test_relay_tools_list_filters_by_include_policy():
    dao = MockMcpEndpointsDAO()
    await _custom_endpoint(
        dao, tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["a", "b"])
    )
    adapter = MockUpstreamAdapter(result=_tools_list_result(["a", "b", "c"]))
    service = _relay_service(mcp_endpoints_dao=dao, adapters={"http": adapter})

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=McpCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    payload = json.loads(result.body)
    names = {t["name"] for t in payload["result"]["tools"]}
    assert names == {"a", "b"}


@pytest.mark.asyncio
async def test_relay_tools_list_passes_through_untouched_when_policy_is_all():
    dao = MockMcpEndpointsDAO()
    await _custom_endpoint(dao, tool_policy=McpToolPolicy(mode=McpToolPolicyMode.ALL))
    adapter = MockUpstreamAdapter(result=_tools_list_result(["a", "b", "c"]))
    service = _relay_service(mcp_endpoints_dao=dao, adapters={"http": adapter})

    result = await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=McpCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    payload = json.loads(result.body)
    names = {t["name"] for t in payload["result"]["tools"]}
    assert names == {"a", "b", "c"}
