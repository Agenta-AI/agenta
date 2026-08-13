"""McpEndpointsDAO against real Postgres (entities.md §7, WP1 exit condition).

Needs a live deployment — write, do not run without one.
"""

import pytest
from sqlalchemy import text

from oss.src.core.gateways.dtos import GatewayAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import (
    McpEndpointConfig,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointQuery,
    McpToolPolicy,
    McpToolPolicyMode,
)
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.mcps.dao import McpEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _create_dto(*, slug: str) -> McpEndpointCreate:
    return McpEndpointCreate(
        slug=slug,
        name="Acme Notion",
        auth_mode=GatewayAuthScheme.OAUTH,
        data=McpEndpointData(
            url="https://mcp.acme.com",
            tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["search"]),
            config=McpEndpointConfig(timeout_seconds=10.0),
        ),
    )


async def test_create_then_fetch_round_trips_field_for_field(seeded_project):
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-notion")
    create.secret_id = secret_id

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )
    assert created is not None
    assert created.namespace == GatewayEndpointNamespace.CUSTOM
    assert created.connection_id is None
    assert created.provider_key is None
    assert created.integration_key is None

    fetched = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert fetched is not None
    assert fetched.slug == create.slug
    assert fetched.auth_mode == GatewayAuthScheme.OAUTH
    assert fetched.secret_id == secret_id
    assert fetched.data.url == create.data.url
    assert fetched.data.tool_policy.names == ["search"]

    by_slug = await dao.fetch_endpoint_by_slug(
        project_id=project_id,
        #
        slug=create.slug,
    )
    assert by_slug is not None
    assert by_slug.id == created.id


async def test_duplicate_slug_raises_entity_creation_conflict(seeded_project):
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-notion-dup"),
    )

    with pytest.raises(EntityCreationConflict) as excinfo:
        await dao.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=_create_dto(slug="acme-notion-dup"),
        )
    assert excinfo.value.conflict == {"slug": "acme-notion-dup"}


async def test_edit_endpoint_replaces_data_and_flags_wholesale(seeded_project):
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-notion-edit"),
    )
    assert created.data.headers is None

    edit = McpEndpointEdit(
        id=created.id,
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(
            url="https://mcp2.acme.com",
            # tool_policy omitted from the new document -> reverts to ALL, not
            # preserved from the original INCLUDE — this is a PUT, not a PATCH.
        ),
    )

    edited = await dao.edit_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=edit,
    )
    assert edited is not None
    assert edited.auth_mode == GatewayAuthScheme.NONE
    assert edited.data.url == "https://mcp2.acme.com"
    assert edited.data.tool_policy.mode == McpToolPolicyMode.ALL
    assert edited.updated_by_id == user_id

    refetched = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert refetched.data.tool_policy.mode == McpToolPolicyMode.ALL


async def test_delete_endpoint_is_idempotent(seeded_project):
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-notion-delete"),
    )

    first = await dao.delete_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert first is True

    second = await dao.delete_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert second is False

    assert (
        await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id) is None
    )


async def test_query_endpoints_filters_by_auth_mode_and_slug(seeded_project):
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    oauth_endpoint = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-notion-query-oauth"),
    )
    none_endpoint = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=McpEndpointCreate(
            slug="acme-notion-query-none",
            auth_mode=GatewayAuthScheme.NONE,
            data=McpEndpointData(url="https://open.acme.com"),
        ),
    )

    by_auth_mode = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=McpEndpointQuery(auth_mode=GatewayAuthScheme.NONE),
    )
    assert {e.id for e in by_auth_mode} == {none_endpoint.id}

    by_slug = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=McpEndpointQuery(slug="acme-notion-query-oauth"),
    )
    assert {e.id for e in by_slug} == {oauth_endpoint.id}


async def test_deleting_secret_sets_endpoint_secret_id_null(seeded_project):
    """D18/§2.1: a dead credential must not silently delete configuration."""
    dao = McpEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-notion-fk-set-null")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )
    assert created.secret_id == secret_id

    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE id = :id"), {"id": secret_id}
        )
        await session.commit()

    survivor = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert survivor is not None
    assert survivor.secret_id is None
