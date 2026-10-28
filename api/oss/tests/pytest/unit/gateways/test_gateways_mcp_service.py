"""Unit tests for `MCPGatewayService`.

Every case runs against in-memory mocks — a dict-backed `MCPEndpointsDAOInterface`, a
a stub `ConnectionsService`, a call-logging
`GatewayPolicyService`, and a call-logging `SecretsResolverInterface`. No Postgres, no
HTTP, or real upstream. Covers CRUD delegation, endpoint listing, connection state, grants,
and relay orchestration.
"""

from contextlib import asynccontextmanager

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
    MCPOAuthConfig,
    MCPToolFilter,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
    MCPRelayResult,
)
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.providers.composio import ComposioMCPAdapter
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthNoRefreshTokenError,
    MCPOAuthRefreshFailedError,
    MCPOAuthRefreshUnavailableError,
)
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPConnectionBusyError,
    MCPConnectionChangedError,
    MCPConnectionNameTakenError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretOwner,
    SecretOwnerKind,
    PolicyDecision,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import PolicyDeniedError, SecretNotFoundError
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

    # A person's own servers (M7): the project service paths never call these.
    async def query_owned_endpoints(self, *, owner):
        return [e for e in self._endpoints_by_owner(owner)]

    async def fetch_owned_endpoint_by_slug(self, *, owner, slug):
        return next(
            (e for e in self._endpoints_by_owner(owner) if e.slug == slug), None
        )

    async def delete_owned_endpoints(self, *, owner, endpoint_id=None):
        return 0

    def _endpoints_by_owner(self, owner):
        return [e for e in self._by_id.values() if getattr(e, "owner", None) == owner]

    def __init__(self) -> None:
        self._by_id: Dict[UUID, MCPEndpoint] = {}
        self.calls: List[str] = []

    async def create_endpoint(
        self, *, project_id, user_id, endpoint, owner=None
    ) -> Optional[MCPEndpoint]:
        self.calls.append("create_endpoint")
        created = MCPEndpoint(id=uuid4(), owner=owner, **endpoint.model_dump())
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

    async def cache_endpoint_discovery(
        self, *, project_id, user_id, endpoint_id, oauth
    ) -> Optional[MCPEndpoint]:
        self.calls.append("cache_endpoint_discovery")
        existing = self._by_id.get(endpoint_id)
        if existing is None:
            return None
        # One key of the stored data, like the real DAO (D31).
        updated = existing.model_copy(
            update={"data": existing.data.model_copy(update={"oauth": oauth})}
        )
        self._by_id[endpoint_id] = updated
        return updated

    async def record_endpoint_check(
        self, *, project_id, user_id, endpoint_id, check
    ) -> Optional[MCPEndpoint]:
        self.calls.append("record_endpoint_check")
        existing = self._by_id.get(endpoint_id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={"data": existing.data.model_copy(update={"check": check})}
        )
        self._by_id[endpoint_id] = updated
        return updated

    @asynccontextmanager
    async def oauth_lock(self, *, project_id, endpoint_id):
        yield

    async def bind_endpoint_secret(
        self, *, project_id, user_id, endpoint_id, secret_id
    ) -> Optional[MCPEndpoint]:
        self.calls.append("bind_endpoint_secret")
        existing = self._by_id.get(endpoint_id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={
                "secret_id": secret_id,
                "flags": MCPEndpointFlags(
                    is_active=existing.flags.is_active, is_valid=True
                ),
            }
        )
        self._by_id[endpoint_id] = updated
        return updated

    async def invalidate_endpoint_secret(
        self, *, project_id, user_id, endpoint_id, secret_id
    ) -> Optional[MCPEndpoint]:
        self.calls.append("invalidate_endpoint_secret")
        existing = self._by_id.get(endpoint_id)
        if existing is None:
            return None
        # Conditional on the handle the caller was using, like the real DAO (D21).
        if existing.secret_id is None or existing.secret_id != secret_id:
            return existing
        updated = existing.model_copy(
            update={
                "flags": MCPEndpointFlags(
                    is_active=existing.flags.is_active, is_valid=False
                )
            }
        )
        self._by_id[endpoint_id] = updated
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


def _endpoint_create(
    slug: str = "acme-notion", name: Optional[str] = None
) -> MCPEndpointCreate:
    return MCPEndpointCreate(
        slug=slug,
        name=name,
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

    # One indexed read to see whether the name moved, then the write. The project-wide
    # name scan is not among them, because this edit did not touch the name (D12).
    assert dao.calls == ["fetch_endpoint", "edit_endpoint"]
    assert "query_endpoints" not in dao.calls
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

    assert dao.calls == ["fetch_endpoint", "delete_endpoint"]
    assert deleted is True


@pytest.mark.asyncio
async def test_a_sheet_abandoning_its_pending_row_deletes_it():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    pending = await _oauth_endpoint(dao, connected=False)

    deleted = await service.delete_endpoint(
        project_id=uuid4(),
        endpoint_id=pending.id,
        pending_auth_mode=MCPAuthScheme.OAUTH,
    )

    assert deleted is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "auth_mode", [MCPAuthScheme.API_KEY, MCPAuthScheme.OAUTH], ids=["key", "grant"]
)
async def test_a_sheet_abandoning_a_row_another_tab_took_over_keeps_it(auth_mode):
    """Another tab saved a key on the row, or finished its sign-in. The sheet that made
    the row only gives up its own attempt."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    taken = await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme-notion",
            auth_mode=auth_mode,
            secret_id=uuid4(),
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp")
            ),
        ),
    )

    with pytest.raises(MCPConnectionChangedError):
        await service.delete_endpoint(
            project_id=uuid4(),
            endpoint_id=taken.id,
            pending_auth_mode=MCPAuthScheme.OAUTH,
        )

    assert "delete_endpoint" not in dao.calls


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
        self._secret = secret
        self._raise = raise_exc
        self._provider_keys = provider_keys or set()

    async def resolve(self, *, scope, ref):
        self.resolve_calls += 1
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
            id=user_id or uuid4(),
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
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=uuid4()),
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


async def _oauth_endpoint(
    dao: "MockMCPEndpointsDAO", *, connected: bool = True
) -> MCPEndpoint:
    return await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme-notion",
            auth_mode=MCPAuthScheme.OAUTH,
            secret_id=uuid4() if connected else None,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp")
            ),
        ),
    )


@pytest.mark.asyncio
async def test_an_oauth_connection_with_no_grant_offers_a_reconnect():
    """Every OAuth connection is in this state before its first consent and again after a
    disconnect. It used to refuse with `secret_missing` and no action at all, which is a
    true statement and a dead end: the caller was told a credential was missing and given
    no way to supply one."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao, connected=False)
    resolver = MockResolver()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
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
    # A connection with no grant costs no vault read: there is nothing to look up.
    assert resolver.resolve_calls == 0


@pytest.mark.asyncio
async def test_a_connection_with_no_grant_is_not_marked_invalid():
    """Nothing died. A missing grant already reads as needing authorization on its own,
    and marking the connection invalid would say its credential failed."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao, connected=False)
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(),
        adapters={"http": MockUpstreamAdapter()},
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
    assert stored is not None and stored.flags.is_valid is True


@pytest.mark.asyncio
async def test_an_oauth_connection_naming_a_grant_the_vault_lost_offers_a_reconnect():
    """The row still holds a handle and the vault no longer holds the row. The caller's
    position is the same as having never connected, so the answer is too."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(
            raise_exc=SecretNotFoundError(
                missing=SecretOwnerKind.PROJECT,
                target="custom/acme-notion",
            )
        ),
        adapters={"http": MockUpstreamAdapter()},
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

    assert excinfo.value.requirement.connect is not None
    assert excinfo.value.requirement.connect.endpoint == (
        f"/gateways/mcps/endpoints/{endpoint.id}/connect"
    )


@pytest.mark.asyncio
async def test_an_api_key_connection_with_no_secret_still_says_the_secret_is_missing():
    """Only OAuth has a consent flow to send anyone back through. An API-key connection
    needs a value typed into its configuration, which is a different instruction, and
    `/connect` would not produce one."""
    dao = MockMCPEndpointsDAO()
    await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme-notion",
            auth_mode=MCPAuthScheme.API_KEY,
            secret_id=None,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp")
            ),
        ),
    )
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(),
        adapters={"http": MockUpstreamAdapter()},
    )

    with pytest.raises(SecretNotFoundError):
        await service.relay(
            scope=_scope(),
            namespace="custom",
            name="acme-notion",
            context=MCPCallContext(method="tools/call", target="write_page"),
            body=b"{}",
            headers={},
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
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=uuid4()),
        origin=SecretOrigin.VAULT,
    )


class _SequenceResolver(MockResolver):
    """Hands out a different secret per call, so a re-read after a refresh is visible."""

    def __init__(self, *, secrets: List[ResolvedSecret]) -> None:
        super().__init__()
        self._secrets = list(secrets)

    async def resolve(self, *, scope, ref):
        self.resolve_calls += 1
        return self._secrets[min(self.resolve_calls, len(self._secrets)) - 1]


class _StubRefresher:
    def __init__(self, *, failure: Optional[Exception] = None) -> None:
        self.calls: List[str] = []
        # Which connection each refresh was asked for. A relay must renew the grant of
        # the endpoint it resolved, not of whatever else shares that server URL.
        self.endpoint_ids: List[UUID] = []
        # The refused token each forced refresh named, `None` for a refresh by expiry.
        self.failed_access_tokens: List[Optional[str]] = []
        self._failure = failure

    async def refresh_grant(
        self, *, project_id, endpoint_id, server_url, failed_access_token=None
    ) -> None:
        self.calls.append(server_url)
        self.endpoint_ids.append(endpoint_id)
        self.failed_access_tokens.append(failed_access_token)
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


class _SequenceAdapter(MockUpstreamAdapter):
    """Answers each relay with the next result in turn, so a retry sees a new answer."""

    def __init__(self, *, results: List[MCPRelayResult]) -> None:
        super().__init__()
        self._results = list(results)
        self.sent_tokens: List[str] = []

    async def relay(self, *, route, auth, context, body, headers):
        await super().relay(
            route=route, auth=auth, context=context, body=body, headers=headers
        )
        self.sent_tokens.append(auth.secret.secret.data.grant.access_token)
        return self._results[min(self.relay_calls, len(self._results)) - 1]


def _live_grant_service(*, adapter, refresher, secrets=None, policy=None):
    import time

    resolver = _SequenceResolver(
        secrets=secrets
        or [
            _grant_secret(access_token="revoked", expires_at=int(time.time()) + 3600),
            _grant_secret(access_token="renewed", expires_at=int(time.time()) + 3600),
        ]
    )
    dao = MockMCPEndpointsDAO()
    return dao, _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        policy=policy,
        adapters={"http": adapter},
        oauth_refresher=refresher,
    )


async def _relay_write_page(service):
    return await service.relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
    )


@pytest.mark.asyncio
async def test_a_401_refreshes_the_refused_token_and_retries_the_call_once():
    """A provider can retire a token before the expiry it stated. A grant with a refresh
    token recovers from that without the person."""
    adapter = _SequenceAdapter(
        results=[
            _refused_credential_result(),
            MCPRelayResult(status_code=200, headers={}, body=b"{}"),
        ]
    )
    refresher = _StubRefresher()
    policy = MockPolicyService()
    dao, service = _live_grant_service(
        adapter=adapter, refresher=refresher, policy=policy
    )
    endpoint = await _oauth_endpoint(dao)

    result = await _relay_write_page(service)

    assert result.status_code == 200
    assert refresher.failed_access_tokens == ["revoked"]
    assert refresher.endpoint_ids == [endpoint.id]
    assert adapter.sent_tokens == ["revoked", "renewed"]
    # One call, one record: the retry is part of it.
    assert [r["outcome"].status_code for r in policy.record_calls] == [200]


@pytest.mark.asyncio
async def test_a_second_401_after_the_refresh_is_a_reconnect_and_not_another_retry():
    adapter = _SequenceAdapter(
        results=[_refused_credential_result(), _refused_credential_result()]
    )
    refresher = _StubRefresher()
    dao, service = _live_grant_service(adapter=adapter, refresher=refresher)
    await _oauth_endpoint(dao)

    with pytest.raises(MCPAuthRequiredError):
        await _relay_write_page(service)

    assert adapter.relay_calls == 2
    assert refresher.failed_access_tokens == ["revoked"]


@pytest.mark.asyncio
async def test_a_401_whose_refresh_is_refused_marks_the_connection_for_a_reconnect():
    """The grant is dead, so the row has to stop reading as connected, not only this call."""
    import time

    refresher = _StubRefresher(
        failure=MCPOAuthRefreshFailedError(server_url="https://example.com/mcp")
    )
    dao, service = _live_grant_service(
        adapter=_SequenceAdapter(results=[_refused_credential_result()]),
        refresher=refresher,
        secrets=[
            _grant_secret(access_token="revoked", expires_at=int(time.time()) + 3600)
        ],
    )
    endpoint = await _oauth_endpoint(dao)

    with pytest.raises(MCPAuthRequiredError):
        await _relay_write_page(service)

    stored = await dao.fetch_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)
    assert stored.flags.is_valid is False


@pytest.mark.asyncio
async def test_a_refresh_that_waited_too_long_for_the_lock_keeps_the_connection():
    import time

    refresher = _StubRefresher(failure=MCPConnectionBusyError())
    dao, service = _live_grant_service(
        adapter=_SequenceAdapter(results=[_refused_credential_result()]),
        refresher=refresher,
        secrets=[
            _grant_secret(access_token="revoked", expires_at=int(time.time()) + 3600)
        ],
    )
    endpoint = await _oauth_endpoint(dao)

    with pytest.raises(MCPUpstreamError) as refusal:
        await _relay_write_page(service)

    assert refusal.value.status_code == 503
    stored = await dao.fetch_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)
    assert stored.flags.is_valid is True


@pytest.mark.asyncio
async def test_a_timeout_is_not_retried_and_refreshes_nothing():
    adapter = MockUpstreamAdapter(
        raise_exc=MCPUpstreamError(target="x", detail="the server did not answer")
    )
    refresher = _StubRefresher()
    dao, service = _live_grant_service(adapter=adapter, refresher=refresher)
    await _oauth_endpoint(dao)

    with pytest.raises(MCPUpstreamError):
        await _relay_write_page(service)

    assert adapter.relay_calls == 1
    assert refresher.calls == []


@pytest.mark.asyncio
async def test_a_tool_error_is_not_retried_and_refreshes_nothing():
    tool_error = MCPRelayResult(
        status_code=200,
        headers={},
        body=b'{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[]}}',
    )
    adapter = _SequenceAdapter(results=[tool_error])
    refresher = _StubRefresher()
    dao, service = _live_grant_service(adapter=adapter, refresher=refresher)
    await _oauth_endpoint(dao)

    result = await _relay_write_page(service)

    assert result is tool_error
    assert adapter.relay_calls == 1
    assert refresher.calls == []


@pytest.mark.parametrize(
    "www_authenticate",
    ['Bearer error="insufficient_scope", scope="notion:write"', ""],
)
@pytest.mark.asyncio
async def test_a_403_refreshes_nothing_and_leaves_the_connection_valid(
    www_authenticate,
):
    """A 403 refuses the request, not the token: a missing scope or the server's own
    policy. Refreshing would not change the answer, and the connection is not dead."""
    adapter = _SequenceAdapter(
        results=[_challenge_result(www_authenticate=www_authenticate)]
    )
    refresher = _StubRefresher()
    dao, service = _live_grant_service(adapter=adapter, refresher=refresher)
    endpoint = await _oauth_endpoint(dao)

    try:
        result = await _relay_write_page(service)
        assert result.status_code == 403
    except MCPScopeInsufficientError:
        assert www_authenticate

    assert adapter.relay_calls == 1
    assert refresher.calls == []
    stored = await dao.fetch_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)
    assert stored.flags.is_valid is not False


@pytest.mark.asyncio
async def test_a_scope_refusal_carries_the_servers_own_words():
    adapter = MockUpstreamAdapter(
        result=_challenge_result(
            www_authenticate=(
                'Bearer error="insufficient_scope", scope="notion:write", '
                'error_description="Writing pages needs the write scope"'
            )
        )
    )
    dao = MockMCPEndpointsDAO()
    await _oauth_endpoint(dao)
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=MockResolver(secret=_resolved_secret()),
        adapters={"http": adapter},
    )

    with pytest.raises(MCPScopeInsufficientError) as refusal:
        await _relay_write_page(service)

    assert "Writing pages needs the write scope" in refusal.value.message


@pytest.mark.asyncio
async def test_a_grant_without_a_refresh_token_asks_for_a_reconnect_in_plain_words():
    adapter = _SequenceAdapter(results=[_refused_credential_result()])
    refresher = _StubRefresher(
        failure=MCPOAuthNoRefreshTokenError(server_url="https://example.com/mcp")
    )
    # The row still holds the refused token, so the connection is marked dead.
    dao, service = _live_grant_service(
        adapter=adapter,
        refresher=refresher,
        secrets=[_grant_secret(access_token="revoked", expires_at=None)],
    )
    endpoint = await _oauth_endpoint(dao)

    with pytest.raises(MCPAuthRequiredError) as refusal:
        await _relay_write_page(service)

    assert refusal.value.message == (
        "No refresh token was issued for this connection. Reconnect to continue."
    )
    assert adapter.relay_calls == 1
    stored = await dao.fetch_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)
    assert stored.flags.is_valid is False


class _UnavailableOnceRefresher(_StubRefresher):
    """A token endpoint that fails on its side once, then answers."""

    async def refresh_grant(
        self, *, project_id, endpoint_id, server_url, failed_access_token=None
    ) -> None:
        await super().refresh_grant(
            project_id=project_id,
            endpoint_id=endpoint_id,
            server_url=server_url,
            failed_access_token=failed_access_token,
        )
        if len(self.calls) == 1:
            raise MCPOAuthRefreshUnavailableError(
                server_url=server_url, detail="503 from https://auth.example.com"
            )


@pytest.mark.asyncio
async def test_a_token_endpoint_outage_fails_the_call_and_keeps_the_connection():
    """A 503 from the token endpoint says nothing about the grant. The call fails, the
    connection stays valid, and the next call refreshes and goes through."""
    import time

    adapter = _SequenceAdapter(
        results=[
            _refused_credential_result(),
            _refused_credential_result(),
            MCPRelayResult(status_code=200, headers={}, body=b"{}"),
        ]
    )
    refresher = _UnavailableOnceRefresher()
    policy = MockPolicyService()
    dao, service = _live_grant_service(
        adapter=adapter,
        refresher=refresher,
        policy=policy,
        secrets=[
            _grant_secret(access_token="revoked", expires_at=int(time.time()) + 3600),
            _grant_secret(access_token="revoked", expires_at=int(time.time()) + 3600),
            _grant_secret(access_token="renewed", expires_at=int(time.time()) + 3600),
        ],
    )
    endpoint = await _oauth_endpoint(dao)

    with pytest.raises(MCPUpstreamError) as failure:
        await _relay_write_page(service)

    assert failure.value.status_code == 503
    assert policy.record_calls[-1]["outcome"].status_code == 401
    stored = await dao.fetch_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)
    assert stored.flags.is_valid is True

    result = await _relay_write_page(service)

    assert result.status_code == 200
    assert refresher.failed_access_tokens == ["revoked", "revoked"]
    assert adapter.sent_tokens == ["revoked", "revoked", "renewed"]


@pytest.mark.asyncio
async def test_a_check_is_recorded_on_the_connection_and_stamped_now():
    dao = MockMCPEndpointsDAO()
    endpoint = await _oauth_endpoint(dao)
    service = _relay_service(mcp_endpoints_dao=dao, adapters={})

    passed = await service.record_endpoint_check(
        project_id=uuid4(), user_id=uuid4(), endpoint_id=endpoint.id, ok=True
    )
    assert passed.data.check.ok is True
    assert passed.data.check.reason is None
    assert passed.data.check.checked_at is not None

    failed = await service.record_endpoint_check(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=endpoint.id,
        ok=False,
        reason="The server did not accept that credential.",
    )
    assert failed.data.check.ok is False
    assert failed.data.check.reason == "The server did not accept that credential."
    assert failed.data.check.checked_at >= passed.data.check.checked_at
    # The rest of the stored data is untouched.
    assert failed.data.route == endpoint.data.route


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


@pytest.mark.asyncio
async def test_renaming_a_connection_still_checks_the_name_is_free():
    """The scan is skipped only where the answer cannot have changed. A rename is
    exactly where it can."""
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id = uuid4()
    created = await service.create_endpoint(
        project_id=project_id, user_id=uuid4(), endpoint=_endpoint_create()
    )
    dao.calls.clear()

    await service.edit_endpoint(
        project_id=project_id,
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=created.id,
            name="Acme, personal",
            auth_mode=MCPAuthScheme.NONE,
            data=created.data,
        ),
    )

    assert "query_endpoints" in dao.calls


@pytest.mark.asyncio
async def test_a_rename_onto_a_name_another_connection_answers_to_is_refused():
    dao = MockMCPEndpointsDAO()
    service = _service(mcp_endpoints_dao=dao)
    project_id, user_id = uuid4(), uuid4()
    first = await service.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=_endpoint_create(slug="one", name="Acme Notion"),
    )
    second = await service.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=_endpoint_create(slug="two", name="Acme Linear"),
    )

    with pytest.raises(MCPConnectionNameTakenError):
        await service.edit_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointEdit(
                id=second.id,
                # Renders to the same prefix as the first connection's name.
                name="Acme-Notion",
                auth_mode=MCPAuthScheme.NONE,
                data=second.data,
            ),
        )
    assert first.name == "Acme Notion"


# ---------------------------------------------------------------------------
# D62: the same filter against a server that frames its tool list
# ---------------------------------------------------------------------------


def _framed_tools_list_result(
    names: List[str], *, notification_first: bool = False
) -> MCPRelayResult:
    """A `tools/list` answered as an event stream, which is what a Streamable HTTP
    server may send and what this candidate's own mock now sends."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tools": [{"name": n, "description": n, "inputSchema": {}} for n in names]
        },
    }
    frames = []
    if notification_first:
        # The transport permits a notification ahead of the response.
        frames.append(
            "event: message\r\n"
            'data: {"jsonrpc": "2.0", "method": "notifications/progress"}\r\n\r\n'
        )
    frames.append(f"event: message\r\ndata: {json.dumps(payload)}\r\n\r\n")

    return MCPRelayResult(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        body="".join(frames).encode(),
    )


def _tools_in(result: MCPRelayResult) -> set:
    """The tool names a caller reads back, whichever framing was used."""
    body = result.body.decode()
    if "data:" in body:
        payloads = [
            json.loads(line[len("data:") :].strip())
            for line in body.splitlines()
            if line.startswith("data:")
        ]
        payload = next(p for p in payloads if isinstance(p.get("result"), dict))
    else:
        payload = json.loads(body)
    return {tool["name"] for tool in payload["result"]["tools"]}


async def _framed_relay(dao, adapter):
    return await _relay_service(
        mcp_endpoints_dao=dao, adapters={"http": adapter}
    ).relay(
        scope=_scope(),
        namespace="custom",
        name="acme-notion",
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )


@pytest.mark.asyncio
async def test_a_framed_tool_list_is_filtered_like_any_other():
    """The filter read the body with a JSON decoder and returned it unchanged when that
    failed, so a restricted connection advertised everything the server had."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(allowlist=["a", "b"]))
    adapter = MockUpstreamAdapter(result=_framed_tools_list_result(["a", "b", "c"]))

    result = await _framed_relay(dao, adapter)

    assert _tools_in(result) == {"a", "b"}


@pytest.mark.asyncio
async def test_a_notification_before_the_framed_list_does_not_hide_it():
    """The response is found by looking at each frame rather than taking the last one,
    because the transport lets a server speak before it answers."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(denylist=["c"]))
    adapter = MockUpstreamAdapter(
        result=_framed_tools_list_result(["a", "b", "c"], notification_first=True)
    )

    result = await _framed_relay(dao, adapter)

    assert _tools_in(result) == {"a", "b"}
    # And the frame it did not rewrite is still there, unchanged.
    assert "notifications/progress" in result.body.decode()


@pytest.mark.asyncio
async def test_a_framed_body_keeps_its_framing_after_filtering():
    """The caller asked an event stream and must get one back, or its client cannot
    read the answer at all."""
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter(allowlist=["a"]))
    adapter = MockUpstreamAdapter(result=_framed_tools_list_result(["a", "b"]))

    result = await _framed_relay(dao, adapter)

    body = result.body.decode()
    assert body.startswith("event: message\r\n")
    assert body.endswith("\r\n\r\n")
    assert "data: " in body


@pytest.mark.asyncio
async def test_an_unconstrained_connection_leaves_a_framed_body_byte_identical():
    dao = MockMCPEndpointsDAO()
    await _custom_endpoint(dao, tools=MCPToolFilter())
    sent = _framed_tools_list_result(["a", "b", "c"])
    adapter = MockUpstreamAdapter(result=sent)

    result = await _framed_relay(dao, adapter)

    assert result.body == sent.body


@pytest.mark.asyncio
async def test_a_key_connection_to_a_server_that_publishes_oauth_relays_with_the_key():
    """The mode the person chose is the truth, and the probe only suggested one.

    GitHub's MCP server publishes OAuth metadata and also accepts a personal access token.
    A connection created in `api_key` mode for it stays in that mode, is not re-derived
    from the server's metadata, and relays with the project secret it names rather than
    asking for consent.
    """
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        resolver=MockResolver(secret=_resolved_secret()),
        adapters={"http": adapter},
    )
    secret_id = uuid4()

    created = await service.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            name="GitHub",
            auth_mode=MCPAuthScheme.API_KEY,
            secret_id=secret_id,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://api.githubcopilot.com/mcp/")
            ),
        ),
    )

    assert created.auth_mode == MCPAuthScheme.API_KEY
    assert created.secret_id == secret_id

    await service.relay(
        scope=_scope(),
        namespace="custom",
        name=created.slug,
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    assert adapter.relay_calls == 1
    assert adapter.last_auth.secret is not None


@pytest.mark.asyncio
async def test_the_url_secret_is_the_project_secret_the_relay_would_send():
    """The probe of a `{secret}` address reads the value the way the relay does: the bound
    project secret, scoped to the project."""
    from unittest.mock import AsyncMock

    secret_id = uuid4()
    resolver = AsyncMock()
    resolver.resolve.return_value = SimpleNamespace(
        secret=SimpleNamespace(
            data=SimpleNamespace(secret=SimpleNamespace(content="test-key-one"))
        )
    )
    scope = _scope()

    value = await _service(resolver=resolver).probe_secret_value(
        scope=scope, secret_id=secret_id
    )

    assert value == "test-key-one"
    resolver.resolve.assert_awaited_once_with(
        scope=scope,
        ref=BoundSecretRef(secret_id=secret_id),
    )


class _ReleasingRefresher:
    """Records which grants an edit asked to retire."""

    def __init__(self) -> None:
        self.released: List[UUID] = []
        self.cancelled: List[UUID] = []

    async def refresh_grant(
        self, *, project_id, endpoint_id, server_url, failed_access_token=None
    ) -> None:
        raise AssertionError("an edit does not refresh")

    async def release_grant(self, *, project_id, endpoint_id, server_url) -> None:
        self.released.append(endpoint_id)

    async def cancel_attempts(self, *, project_id, endpoint_id, attempt_id=None) -> int:
        self.cancelled.append(endpoint_id)
        return 1


class _SigningInRefresher(_ReleasingRefresher):
    """Holds the sign-ins in flight on one connection, by attempt id."""

    def __init__(self, *active: UUID) -> None:
        super().__init__()
        self.active = set(active)

    async def cancel_attempts(self, *, project_id, endpoint_id, attempt_id=None) -> int:
        cancelled = self.active if attempt_id is None else self.active & {attempt_id}
        self.active -= cancelled
        return len(cancelled)

    async def has_active_attempts(self, *, project_id, endpoint_id) -> bool:
        return bool(self.active)


@pytest.mark.asyncio
async def test_a_sheet_abandoning_a_row_another_tab_is_signing_in_on_keeps_it():
    """Tab A made the pending row and tab B started its own sign-in on it. A cancels its
    sign-in, then asks to delete the row: the row and B's sign-in both stay."""
    dao = MockMCPEndpointsDAO()
    sheet_attempt, other_tab_attempt = uuid4(), uuid4()
    refresher = _SigningInRefresher(sheet_attempt, other_tab_attempt)
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    pending = await _oauth_endpoint(dao, connected=False)
    await refresher.cancel_attempts(
        project_id=uuid4(), endpoint_id=pending.id, attempt_id=sheet_attempt
    )

    with pytest.raises(MCPConnectionChangedError):
        await service.delete_endpoint(
            project_id=uuid4(),
            endpoint_id=pending.id,
            pending_auth_mode=MCPAuthScheme.OAUTH,
        )

    assert "delete_endpoint" not in dao.calls
    assert refresher.active == {other_tab_attempt}
    assert refresher.released == []


@pytest.mark.asyncio
async def test_a_sheet_abandoning_its_row_after_cancelling_its_sign_in_deletes_it():
    dao = MockMCPEndpointsDAO()
    sheet_attempt = uuid4()
    refresher = _SigningInRefresher(sheet_attempt)
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    pending = await _oauth_endpoint(dao, connected=False)
    await refresher.cancel_attempts(
        project_id=uuid4(), endpoint_id=pending.id, attempt_id=sheet_attempt
    )

    deleted = await service.delete_endpoint(
        project_id=uuid4(),
        endpoint_id=pending.id,
        pending_auth_mode=MCPAuthScheme.OAUTH,
    )

    assert deleted is True
    assert refresher.released == [pending.id]


async def _edited_from_oauth(*, auth_mode, base_url, oauth_config=None):
    dao = MockMCPEndpointsDAO()
    refresher = _ReleasingRefresher()
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    endpoint = await _oauth_endpoint(dao)
    await service.edit_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=endpoint.id,
            name=endpoint.name,
            auth_mode=auth_mode,
            data=endpoint.data.model_copy(
                update={
                    "route": MCPEndpointRoute(base_url=base_url),
                    "oauth_config": oauth_config,
                }
            ),
        ),
    )
    return endpoint, refresher


@pytest.mark.asyncio
async def test_an_edit_off_oauth_retires_the_grant():
    endpoint, refresher = await _edited_from_oauth(
        auth_mode=MCPAuthScheme.API_KEY, base_url="https://example.com/mcp"
    )

    assert refresher.released == [endpoint.id]


@pytest.mark.asyncio
async def test_an_address_change_retires_the_grant_issued_for_the_old_address():
    endpoint, refresher = await _edited_from_oauth(
        auth_mode=MCPAuthScheme.OAUTH, base_url="https://mcp.other.example/"
    )

    assert refresher.released == [endpoint.id]


@pytest.mark.asyncio
async def test_an_edit_that_keeps_mode_and_address_retires_nothing():
    endpoint, refresher = await _edited_from_oauth(
        auth_mode=MCPAuthScheme.OAUTH, base_url="https://example.com/mcp"
    )

    assert refresher.released == []
    assert refresher.cancelled == []


@pytest.mark.parametrize(
    "auth_mode, released", [(MCPAuthScheme.OAUTH, True), (MCPAuthScheme.NONE, False)]
)
@pytest.mark.asyncio
async def test_deleting_a_connection_takes_its_oauth_grant_with_it(auth_mode, released):
    """Deleting the row alone left the grant in the vault with nothing naming it:
    unreachable, unlistable as a connection, and still holding a live token."""
    dao = MockMCPEndpointsDAO()
    refresher = _ReleasingRefresher()
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    endpoint = await _oauth_endpoint(dao)
    dao._by_id[endpoint.id] = endpoint.model_copy(update={"auth_mode": auth_mode})

    assert await service.delete_endpoint(project_id=uuid4(), endpoint_id=endpoint.id)

    assert refresher.released == ([endpoint.id] if released else [])


@pytest.mark.asyncio
async def test_a_changed_oauth_client_cancels_the_consents_and_keeps_the_grant():
    """A consent begun as one client must not finish as another. The grant stays: it
    renews only as the client it was issued to."""
    endpoint, refresher = await _edited_from_oauth(
        auth_mode=MCPAuthScheme.OAUTH,
        base_url="https://example.com/mcp",
        oauth_config=MCPOAuthConfig(client_id="app-from-github"),
    )

    assert refresher.cancelled == [endpoint.id]
    assert refresher.released == []


@pytest.mark.asyncio
async def test_a_switch_to_oauth_cancels_the_consents_and_retires_nothing():
    dao = MockMCPEndpointsDAO()
    refresher = _ReleasingRefresher()
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    endpoint = await _oauth_endpoint(dao)
    dao._by_id[endpoint.id] = endpoint.model_copy(
        update={"auth_mode": MCPAuthScheme.API_KEY}
    )

    await service.edit_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=endpoint.id,
            name=endpoint.name,
            auth_mode=MCPAuthScheme.OAUTH,
            data=endpoint.data,
        ),
    )

    assert refresher.cancelled == [endpoint.id]
    assert refresher.released == []
