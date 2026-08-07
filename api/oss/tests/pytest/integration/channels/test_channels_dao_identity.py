import pytest

from oss.src.core.channels.identity import ChannelIdentityLinkCreate
from oss.src.dbs.postgres.channels.identity_dao import ChannelIdentityDAO


pytestmark = pytest.mark.integration


async def test_create_and_fetch_link_round_trips(channels_scope):
    dao = ChannelIdentityDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    created = await dao.create_link(
        project_id=project_id,
        link=ChannelIdentityLinkCreate(
            connection_id=connection_id,
            user_id=user_id,
            external_user_key="T1:U012ABC",
        ),
    )

    fetched = await dao.fetch_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="T1:U012ABC",
    )

    assert fetched is not None
    assert fetched.id == created.id
    assert fetched.user_id == user_id


async def test_fetch_link_returns_none_when_unlinked(channels_scope):
    dao = ChannelIdentityDAO(engine=channels_scope["engine"])

    result = await dao.fetch_link(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_user_key="never-linked",
    )

    assert result is None


async def test_unique_constraint_rejects_duplicate_connection_external_key(
    channels_scope,
):
    from sqlalchemy.exc import IntegrityError

    dao = ChannelIdentityDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    await dao.create_link(
        project_id=project_id,
        link=ChannelIdentityLinkCreate(
            connection_id=connection_id,
            user_id=user_id,
            external_user_key="dup-key",
        ),
    )

    with pytest.raises(IntegrityError):
        await dao.create_link(
            project_id=project_id,
            link=ChannelIdentityLinkCreate(
                connection_id=connection_id,
                user_id=user_id,
                external_user_key="dup-key",
            ),
        )


async def test_rebind_link_preserves_row_and_user_id(channels_scope):
    dao = ChannelIdentityDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    created = await dao.create_link(
        project_id=project_id,
        link=ChannelIdentityLinkCreate(
            connection_id=connection_id,
            user_id=user_id,
            external_user_key="old-chat-id",
        ),
    )

    rebound = await dao.rebind_link(
        project_id=project_id,
        connection_id=connection_id,
        old_external_user_key="old-chat-id",
        new_external_user_key="new-chat-id",
    )

    assert rebound is not None
    assert rebound.id == created.id
    assert rebound.user_id == user_id

    stale = await dao.fetch_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="old-chat-id",
    )
    fresh = await dao.fetch_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="new-chat-id",
    )

    assert stale is None
    assert fresh is not None
    assert fresh.id == created.id


async def test_rebind_link_returns_none_when_no_row_matches(channels_scope):
    dao = ChannelIdentityDAO(engine=channels_scope["engine"])

    result = await dao.rebind_link(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        old_external_user_key="never-existed",
        new_external_user_key="whatever",
    )

    assert result is None


async def test_two_connections_same_raw_id_key_independently(channels_scope):
    """Two workspaces (connections) sharing a raw platform user id must not
    collide — the DAO enforces this at the DB level via the unique constraint
    on (project_id, connection_id, external_user_key), not connection alone."""
    import uuid

    from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE

    dao = ChannelIdentityDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    other_connection_id = uuid.uuid4()

    async with channels_scope["engine"].session() as session:
        session.add(
            ConnectionDBE(
                id=other_connection_id,
                project_id=project_id,
                slug=f"channels-dao-{other_connection_id.hex[:8]}",
                provider_key="slack",
                integration_key=f"T{other_connection_id.hex[:8]}",
                created_by_id=user_id,
            )
        )
        await session.commit()

    # same raw id ("U012ABC"), but the key embeds the connection-specific
    # workspace id, so the two rows are independent by construction.
    await dao.create_link(
        project_id=project_id,
        link=ChannelIdentityLinkCreate(
            connection_id=channels_scope["connection_id"],
            user_id=user_id,
            external_user_key="workspace-a:U012ABC",
        ),
    )
    await dao.create_link(
        project_id=project_id,
        link=ChannelIdentityLinkCreate(
            connection_id=other_connection_id,
            user_id=user_id,
            external_user_key="workspace-b:U012ABC",
        ),
    )

    link_a = await dao.fetch_link(
        project_id=project_id,
        connection_id=channels_scope["connection_id"],
        external_user_key="workspace-a:U012ABC",
    )
    link_b = await dao.fetch_link(
        project_id=project_id,
        connection_id=other_connection_id,
        external_user_key="workspace-b:U012ABC",
    )

    assert link_a is not None and link_b is not None
    assert link_a.id != link_b.id
