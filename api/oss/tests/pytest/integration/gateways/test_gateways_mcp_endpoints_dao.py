"""MCPEndpointsDAO against real Postgres (entities.md §7, WP1 exit condition).

Needs a live deployment_kind — write, do not run without one.
"""

import pytest
from sqlalchemy import text

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpointSettings,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointQuery,
    MCPEndpointRoute,
    MCPOAuthData,
    MCPToolFilter,
)
from oss.src.core.gateways.policy.types import SecretInvalidError
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _create_dto(*, slug: str) -> MCPEndpointCreate:
    return MCPEndpointCreate(
        slug=slug,
        name="Acme Notion",
        auth_mode=MCPAuthScheme.OAUTH,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp.acme.com"),
            tools=MCPToolFilter(allowlist=["search"]),
            settings=MCPEndpointSettings(timeout_seconds=10.0),
        ),
    )


async def test_create_then_fetch_round_trips_field_for_field(seeded_project):
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
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
    assert fetched.auth_mode == MCPAuthScheme.OAUTH
    assert fetched.secret_id == secret_id
    assert fetched.data.route.base_url == create.data.route.base_url
    assert fetched.data.tools.allowlist == ["search"]

    by_slug = await dao.fetch_endpoint_by_slug(
        project_id=project_id,
        #
        slug=create.slug,
    )
    assert by_slug is not None
    assert by_slug.id == created.id


async def test_duplicate_slug_raises_entity_creation_conflict(seeded_project):
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
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
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-notion-edit"),
    )
    assert created.data.route.headers is None

    edit = MCPEndpointEdit(
        id=created.id,
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp2.acme.com"),
            # tools omitted from the new document -> reverts to unconstrained, not
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
    assert edited.auth_mode == MCPAuthScheme.NONE
    assert edited.data.route.base_url == "https://mcp2.acme.com"
    assert edited.data.tools.allowlist is None
    assert edited.updated_by_id == user_id

    refetched = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert refetched.data.tools.allowlist is None


async def test_delete_endpoint_is_idempotent(seeded_project):
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
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
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
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
        endpoint=MCPEndpointCreate(
            slug="acme-notion-query-none",
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://open.acme.com")
            ),
        ),
    )

    by_auth_mode = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=MCPEndpointQuery(auth_mode=MCPAuthScheme.NONE),
    )
    assert {e.id for e in by_auth_mode} == {none_endpoint.id}

    by_slug = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=MCPEndpointQuery(slug="acme-notion-query-oauth"),
    )
    assert {e.id for e in by_slug} == {oauth_endpoint.id}


async def test_deleting_secret_sets_endpoint_secret_id_null(seeded_project):
    """D18/§2.1: a dead secret must not silently delete configuration."""
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
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


async def test_create_refuses_a_credential_from_another_project(
    seeded_project, other_project
):
    """OR62 on the MCP plane: same foreign key, same gap, same check."""
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    create = _create_dto(slug="acme-foreign-create")
    create.secret_id = other_project["secret_id"]

    with pytest.raises(SecretInvalidError):
        await dao.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=create,
        )

    assert (
        await dao.fetch_endpoint_by_slug(
            project_id=project_id,
            #
            slug="acme-foreign-create",
        )
        is None
    )


async def test_edit_refuses_rebinding_to_another_projects_credential(
    seeded_project, other_project
):
    """The MCP edit path re-binds the credential on every call (OAuth connect, invalidate)."""
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-foreign-edit"),
    )
    assert created.secret_id is None

    with pytest.raises(SecretInvalidError):
        await dao.edit_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=MCPEndpointEdit(
                id=created.id,
                auth_mode=MCPAuthScheme.OAUTH,
                secret_id=other_project["secret_id"],
                data=MCPEndpointData(
                    route=MCPEndpointRoute(base_url="https://mcp.acme.com"),
                ),
            ),
        )

    refetched = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    assert refetched.secret_id is None


async def test_a_create_with_no_slug_is_given_one_rather_than_silently_failing(
    seeded_project,
):
    """`slug` is NOT NULL, and a create without one used to raise a not-null violation
    that the DAO's suppress decorator swallowed: the route answered `200 {"count": 0}`
    and wrote nothing. The service derives the slug now, so the row exists and is
    reachable by it."""
    from oss.src.core.gateways.mcps.service import derive_endpoint_slug

    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    create = MCPEndpointCreate(
        name="Acme, personal",
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url="https://mcp.acme.com")),
    )
    assert create.slug is None
    create.slug = derive_endpoint_slug(create)

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )

    assert created is not None
    assert created.slug.startswith("acme-personal-")
    fetched = await dao.fetch_endpoint_by_slug(
        project_id=project_id,
        #
        slug=created.slug,
    )
    assert fetched is not None and fetched.id == created.id


async def test_a_create_the_database_refuses_reaches_the_caller(seeded_project):
    """The other half: whatever the derivation does not cover must not be swallowed
    into a `None` the route reports as a zero-count success."""
    from sqlalchemy.exc import IntegrityError

    dao = MCPEndpointsDAO(engine=get_transactions_engine())

    with pytest.raises(IntegrityError):
        await dao.create_endpoint(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
            #
            endpoint=_create_dto(slug=None),
        )


@pytest.mark.asyncio
async def test_bind_refuses_a_credential_from_another_project_out_loud(
    seeded_project, other_project
):
    """D20. The credential write carried a bare exception suppressor, so the tenant
    refusal was swallowed and the method answered `None`. Tenant isolation held either
    way — the exception aborts the transaction before the commit — but the connect route
    turned that `None` into a reported success that had bound nothing."""
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-foreign-bind"),
    )

    with pytest.raises(SecretInvalidError):
        await dao.bind_endpoint_secret(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint_id=created.id,
            secret_id=other_project["secret_id"],
        )

    refetched = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    assert refetched.secret_id is None


@pytest.mark.asyncio
async def test_caching_discovery_keeps_the_credential_the_connection_holds(
    seeded_project,
):
    """D31, against the database rather than a stand-in.

    The connect route reads the connection, makes an outbound call, and only then writes
    what discovery found. The write used to replay the row from that pre-call snapshot,
    so a callback that bound a grant in the meantime had its handle overwritten with the
    `None` the snapshot carried.

    The unit cases for this merge by construction, because their store is a dictionary
    that only assigns the key it was given. This one asserts the property the real column
    has to have: two writers, one row, and the second must not carry the first away.
    """
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-discovery-keeps-handle"),
    )
    assert created.secret_id is None

    # What the route is holding: the connection as it was before it dialled out.
    snapshot = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    assert snapshot.secret_id is None

    # Meanwhile the callback binds the grant this consent produced.
    await dao.bind_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint_id=created.id,
        secret_id=seeded_project["secret_id"],
    )

    # Now discovery's write lands, built from the snapshot above.
    cached = await dao.cache_endpoint_discovery(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint_id=snapshot.id,
        oauth=MCPOAuthData(
            resource="https://mcp.acme.com/",
            authorization_server="https://auth.acme.com/",
            scopes_offered=["read", "write"],
        ),
    )

    assert cached is not None
    stored = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    # The handle the callback wrote is still there.
    assert stored.secret_id == seeded_project["secret_id"]
    assert stored.flags.is_valid is True
    # And discovery's own metadata landed.
    assert stored.data.oauth is not None
    assert stored.data.oauth.scopes_offered == ["read", "write"]
    assert stored.data.oauth.authorization_server == "https://auth.acme.com/"
    # Everything else the connection was created with is untouched.
    assert stored.data.route.base_url == "https://mcp.acme.com"
    assert stored.data.tools.allowlist == ["search"]
    assert stored.data.settings.timeout_seconds == 10.0
    assert stored.name == "Acme Notion"


async def test_invalidate_skips_a_reconnect_that_landed_in_between(seeded_project):
    # Issue #6879: the credential read (D33) and the invalidating write are two
    # transactions, so a reconnect can land between them — same secret id, fresh grant,
    # endpoint re-bound and stamped. The invalidation the old credential earned must not
    # overwrite that repair.
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-raced")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )
    assert created is not None and created.flags.is_valid is True

    snapshot = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)

    rebound = await dao.bind_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
    )
    assert rebound is not None
    assert rebound.updated_at != snapshot.updated_at

    result = await dao.invalidate_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
        expected_updated_at=snapshot.updated_at,
    )

    assert result is not None
    assert result.flags.is_valid is True


async def test_invalidate_still_marks_when_nothing_interleaved(seeded_project):
    # The fingerprint is a guard, not a block: when the row is exactly what the failing
    # relay read, the invalidation still lands.
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-orderly")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )

    snapshot = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)

    result = await dao.invalidate_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
        expected_updated_at=snapshot.updated_at,
    )

    assert result is not None
    assert result.flags.is_valid is False


async def test_invalidate_skips_a_reconnect_on_a_legacy_unstamped_row(seeded_project):
    # A row created before creation stamped it carries a NULL updated_at; the relay
    # still hands that NULL to the invalidation. A supplied NULL must COMPARE — it
    # matches only a row that is still NULL — so a reconnect that stamped the row in
    # between wins even for a legacy row (#6879).
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-legacy")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )

    # Age the row into the legacy shape: no fingerprint at all.
    async with get_transactions_engine().session() as session:
        await session.execute(
            text("UPDATE mcps_endpoints SET updated_at = NULL WHERE id = :id"),
            {"id": created.id},
        )
        await session.commit()

    snapshot = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    assert snapshot.updated_at is None

    # The reconnect lands: rebind stamps the row.
    await dao.bind_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
    )

    result = await dao.invalidate_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
        expected_updated_at=snapshot.updated_at,
    )

    assert result is not None
    assert result.flags.is_valid is True


async def test_invalidate_still_marks_a_legacy_row_that_stayed_untouched(
    seeded_project,
):
    # The NULL fingerprint's other half: a legacy row nobody touched between the relay's
    # read and the write is still NULL, so the NULL matches and the invalidation lands.
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-legacy-quiet")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )

    async with get_transactions_engine().session() as session:
        await session.execute(
            text("UPDATE mcps_endpoints SET updated_at = NULL WHERE id = :id"),
            {"id": created.id},
        )
        await session.commit()

    snapshot = await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id)
    assert snapshot.updated_at is None

    result = await dao.invalidate_endpoint_secret(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=created.id,
        secret_id=secret_id,
        expected_updated_at=snapshot.updated_at,
    )

    assert result is not None
    assert result.flags.is_valid is False
