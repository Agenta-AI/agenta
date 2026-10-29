"""The duplicate-name refusal over real rows, at the service layer that enforces it.

`unit/gateways/test_gateways_mcp_service.py` proves the rule against an in-memory DAO
whose `query_endpoints` ignores `project_id`, so it cannot say whether the scan the check
runs is scoped to one project. That is the half QA could not tell apart from the check
being absent, so it gets a case against Postgres: the same service, the real DAO, two
tenants, and a name that is free in one project and taken in the other.
"""

import uuid

import pytest
from unittest.mock import AsyncMock

from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.types import MCPConnectionNameTakenError
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

_SERVER_URL = "https://mcp.acme.com/"


class _NoConnections:
    """`MCPGatewayService` reaches for brokered connections only when listing; these
    cases never list."""

    async def query_connections(self, **_kwargs):
        return []


def _service() -> MCPGatewayService:
    return MCPGatewayService(
        mcp_endpoints_dao=MCPEndpointsDAO(engine=get_transactions_engine()),
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=AsyncMock(),
        upstream_registry=MCPUpstreamRegistry(adapters={}),
        connections_service=_NoConnections(),
    )


def _create(*, name: str) -> MCPEndpointCreate:
    return MCPEndpointCreate(
        slug=f"acme-{uuid.uuid4().hex[:12]}",
        name=name,
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
    )


@pytest.mark.parametrize(
    "second_name",
    [
        # The same string, which is what a person retrying a create sends.
        "Acme Notion",
        # A different string rendering the same `mcp__Acme_Notion__<tool>`, which is
        # what the comparison on the prefix exists for.
        "Acme-Notion",
        "Acme.Notion",
        # Trimmed before rendering, so padding does not buy a second connection.
        "  Acme Notion  ",
    ],
)
async def test_a_taken_name_is_refused_however_it_is_spelled(
    seeded_project, second_name
):
    service = _service()
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    first = await service.create_endpoint(
        project_id=project_id, user_id=user_id, endpoint=_create(name="Acme Notion")
    )
    assert first is not None

    with pytest.raises(MCPConnectionNameTakenError):
        await service.create_endpoint(
            project_id=project_id, user_id=user_id, endpoint=_create(name=second_name)
        )

    # The refusal left the connection that holds the name exactly as it was, and made
    # no row of its own.
    rows = await service.query_endpoints(project_id=project_id)
    assert [(row.id, row.name) for row in rows] == [(first.id, "Acme Notion")]


async def test_a_rename_onto_a_taken_name_is_refused_and_changes_nothing(
    seeded_project,
):
    service = _service()
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    first = await service.create_endpoint(
        project_id=project_id, user_id=user_id, endpoint=_create(name="Acme Notion")
    )
    second = await service.create_endpoint(
        project_id=project_id, user_id=user_id, endpoint=_create(name="Acme Linear")
    )
    assert first is not None and second is not None

    with pytest.raises(MCPConnectionNameTakenError):
        await service.edit_endpoint(
            project_id=project_id,
            user_id=user_id,
            endpoint=MCPEndpointEdit(
                id=second.id,
                name="Acme-Notion",
                auth_mode=MCPAuthScheme.NONE,
                data=second.data,
            ),
        )

    by_id = {
        row.id: row.name for row in await service.query_endpoints(project_id=project_id)
    }
    assert by_id == {first.id: "Acme Notion", second.id: "Acme Linear"}


async def test_the_same_name_is_free_in_another_project(seeded_project, other_project):
    """Scoped to the project, because the prefix a harness renders is only ambiguous
    among the connections one agent can reach."""
    service = _service()

    mine = await service.create_endpoint(
        project_id=seeded_project["project_id"],
        user_id=seeded_project["user_id"],
        endpoint=_create(name="Acme Notion"),
    )
    theirs = await service.create_endpoint(
        project_id=other_project["project_id"],
        user_id=other_project["user_id"],
        endpoint=_create(name="Acme Notion"),
    )

    assert mine is not None and theirs is not None
    assert mine.id != theirs.id
