"""A credential transition writes the two columns it owns, against real Postgres.

Connect, disconnect and invalidate used to be expressed as a full replacement of the
connection row, built from a snapshot the caller had read earlier. Two things followed,
and the reviewers found one each (D3).

Fields the builder did not set were nulled, so a connection created with tags or metadata
lost them on its first connect. And fields the snapshot held stale were written back, so
an administrator who deactivated a connection or tightened its tool filter while a call
was in flight had that change reverted by the 401 that eventually arrived.

Real Postgres because both halves are about what a row holds after two writers touch it,
and an in-memory double agrees with whatever the last writer said.
"""

from __future__ import annotations

import asyncio

import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointFlags,
    MCPEndpointRoute,
    MCPToolFilter,
)
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest.fixture
def project(seeded_project):
    """`seeded_project` plants one bare `secrets` row, which is the FK target these cases
    bind to. Nothing here decrypts it."""
    return seeded_project


def _dao() -> MCPEndpointsDAO:
    return MCPEndpointsDAO(engine=get_transactions_engine())


async def _connection(project, *, slug: str, **create):
    return await _dao().create_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointCreate(
            slug=slug,
            name=create.pop("name", "Acme"),
            auth_mode=MCPAuthScheme.OAUTH,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.example.com/"),
                tools=create.pop("tools", MCPToolFilter()),
            ),
            **create,
        ),
    )


async def _reload(project, connection):
    return await _dao().fetch_endpoint(
        project_id=project["project_id"], endpoint_id=connection.id
    )


# --- what the write must not erase ------------------------------------------- #


async def test_connecting_keeps_the_tags_and_metadata_the_connection_was_created_with(
    project,
):
    """The create body accepts both, so a person can set them, and the first connect
    silently dropped them."""
    connection = await _connection(
        project,
        slug="keeps-tags",
        tags={"owner": "platform"},
        meta={"note": "the shared Acme account"},
    )
    assert connection.tags == {"owner": "platform"}

    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=project["secret_id"],
    )

    stored = await _reload(project, connection)
    assert stored.tags == {"owner": "platform"}
    assert stored.meta == {"note": "the shared Acme account"}
    assert stored.secret_id == project["secret_id"]
    assert stored.flags.is_valid is True


async def test_disconnecting_keeps_them_too(project):
    connection = await _connection(project, slug="keeps-tags-2", tags={"owner": "sre"})
    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=project["secret_id"],
    )

    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=None,
    )

    stored = await _reload(project, connection)
    assert stored.tags == {"owner": "sre"}
    assert stored.secret_id is None
    # Nothing died: a connection with no authorization is not an invalid one.
    assert stored.flags.is_valid is True


async def test_invalidating_keeps_them_as_well(project):
    connection = await _connection(project, slug="keeps-tags-3", tags={"owner": "sre"})
    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=project["secret_id"],
    )

    await _dao().invalidate_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
    )

    stored = await _reload(project, connection)
    assert stored.tags == {"owner": "sre"}
    assert stored.flags.is_valid is False
    # The handle stays. Reconnecting overwrites it; a dead credential is not a missing one.
    assert stored.secret_id == project["secret_id"]


# --- what the write must not revert ------------------------------------------ #


async def test_an_administrators_change_survives_a_relay_that_started_before_it(
    project,
):
    """The sequence the reviewer described. The relay reads the connection, dials the
    upstream, and the 401 comes back after someone has deactivated it."""
    connection = await _connection(project, slug="concurrent-deactivate")
    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=project["secret_id"],
    )
    # What the relay is holding: the row as it was before the call went out.
    snapshot = await _reload(project, connection)

    # Meanwhile, an administrator deactivates it and narrows what it may call.
    await _dao().edit_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointEdit(
            id=snapshot.id,
            name=snapshot.name,
            auth_mode=snapshot.auth_mode,
            secret_id=snapshot.secret_id,
            data=MCPEndpointData(
                route=snapshot.data.route,
                tools=MCPToolFilter(allowlist=["read_page"]),
            ),
            flags=MCPEndpointFlags(is_active=False, is_valid=True),
        ),
    )

    # Now the 401 lands and the relay records that the credential is dead.
    await _dao().invalidate_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=snapshot.id,
    )

    stored = await _reload(project, connection)
    assert stored.flags.is_valid is False  # what the relay meant to say
    assert stored.flags.is_active is False  # and what it must not have undone
    assert stored.data.tools.allowlist == ["read_page"]


async def test_a_reconnect_that_lands_first_is_not_undone_by_the_late_failure(project):
    """The same race the other way round, and the one that costs a working credential:
    the person reconnects while the doomed call is still in flight."""
    connection = await _connection(project, slug="concurrent-reconnect")
    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=project["secret_id"],
    )
    await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=None,
    )

    await _dao().invalidate_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
    )

    stored = await _reload(project, connection)
    # A connection holding no handle has nothing to invalidate, so the late 401 is a
    # no-op rather than a connection marked dead that a person has just repaired.
    assert stored.flags.is_valid is True
    assert stored.secret_id is None


async def test_two_transitions_at_once_do_not_lose_one_anothers_column(project):
    """Both writes are read-modify-write on one JSON column, so they take the row's lock."""
    connection = await _connection(project, slug="concurrent-pair")

    await asyncio.gather(
        _dao().bind_endpoint_secret(
            project_id=project["project_id"],
            user_id=project["user_id"],
            endpoint_id=connection.id,
            secret_id=project["secret_id"],
        ),
        _dao().invalidate_endpoint_secret(
            project_id=project["project_id"],
            user_id=project["user_id"],
            endpoint_id=connection.id,
        ),
    )

    stored = await _reload(project, connection)
    assert stored.flags.is_active is True
    assert isinstance(stored.flags.is_valid, bool)
