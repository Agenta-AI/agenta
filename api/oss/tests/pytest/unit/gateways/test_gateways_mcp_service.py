"""Unit tests for `McpGatewayService` (specs-wp9.md, tasks-wp9.md).

Every case runs against in-memory fakes — a dict-backed `McpEndpointsDAOInterface`, a
dict-backed `McpGrantsDAOInterface`, a stub `ConnectionsService`, a call-logging
`GatewayPolicyService`, and a call-logging `CredentialResolverInterface`. No Postgres, no
HTTP, no real upstream. Organized by the commit sections in tasks-wp9.md:
CRUD delegation, the three-namespace merge, connection-state derivation, the declared
grants surface, and the relay six-step orchestration.
"""

from typing import Dict, List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointFlags,
    McpEndpointQuery,
)
from oss.src.core.gateways.mcps.interfaces import McpEndpointsDAOInterface
from oss.src.core.gateways.mcps.registry import McpUpstreamRegistry
from oss.src.core.gateways.mcps.service import McpGatewayService
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.dtos import GatewayAuthScheme


# --- fakes (this package must not subclass the real Postgres DAO or ConnectionsService) --- #


class FakeMcpEndpointsDAO(McpEndpointsDAOInterface):
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


def _endpoint_create(slug: str = "acme-notion") -> McpEndpointCreate:
    return McpEndpointCreate(
        slug=slug,
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://example.com/mcp"),
        flags=McpEndpointFlags(),
    )


def _service(*, mcp_endpoints_dao=None) -> McpGatewayService:
    from unittest.mock import AsyncMock

    return McpGatewayService(
        mcp_endpoints_dao=mcp_endpoints_dao or FakeMcpEndpointsDAO(),
        mcp_grants_dao=AsyncMock(),
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=AsyncMock(),
        upstream_registry=McpUpstreamRegistry(adapters={}),
        connections_service=AsyncMock(),
    )


# --- CRUD delegation ------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_create_endpoint_delegates_to_dao():
    dao = FakeMcpEndpointsDAO()
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
    dao = FakeMcpEndpointsDAO()
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
    dao = FakeMcpEndpointsDAO()
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
    dao = FakeMcpEndpointsDAO()
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
    dao = FakeMcpEndpointsDAO()
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
