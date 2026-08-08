from typing import Dict, Optional, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.identity import (
    ChannelIdentityDAOInterface,
    ChannelIdentityLink,
    ChannelIdentityLinkCreate,
    ChannelIdentityService,
)


class FakeChannelIdentityDAO(ChannelIdentityDAOInterface):
    """In-memory double of the DAO interface, implemented for real in
    identity_dao.py — the fake and the real implementation are held to the
    exact same abstract contract."""

    def __init__(self):
        self._rows: Dict[Tuple[UUID, UUID, str], ChannelIdentityLink] = {}

    async def create_link(
        self,
        *,
        project_id: UUID,
        link: ChannelIdentityLinkCreate,
    ) -> ChannelIdentityLink:
        row = ChannelIdentityLink(
            id=uuid4(),
            project_id=project_id,
            connection_id=link.connection_id,
            user_id=link.user_id,
            external_user_key=link.external_user_key,
        )
        self._rows[(project_id, link.connection_id, link.external_user_key)] = row
        return row

    async def fetch_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        return self._rows.get((project_id, connection_id, external_user_key))

    async def rebind_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        old_external_user_key: str,
        new_external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        key = (project_id, connection_id, old_external_user_key)
        row = self._rows.get(key)
        if row is None:
            return None

        del self._rows[key]
        rebound = row.model_copy(update={"external_user_key": new_external_user_key})
        self._rows[(project_id, connection_id, new_external_user_key)] = rebound
        return rebound


def _capabilities(**identity) -> ChannelCapabilities:
    return ChannelCapabilities(channel="slack", identity=identity)


@pytest.mark.asyncio
async def test_unlinked_user_resolves_to_none():
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id, connection_id = uuid4(), uuid4()

    result = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="U012ABC",
    )

    assert result is None


@pytest.mark.asyncio
async def test_linked_user_resolves_to_the_created_account():
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id, connection_id, user_id = uuid4(), uuid4(), uuid4()

    created = await service.create_link(
        project_id=project_id,
        user_id=user_id,
        connection_id=connection_id,
        external_user_key="U012ABC",
    )
    resolved = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="U012ABC",
    )

    assert resolved is not None
    assert resolved.user_id == user_id == created.user_id
    assert resolved.id == created.id


SERVICE_IDENTITY = UUID("00000000-0000-0000-0000-000000000000")


@pytest.mark.asyncio
async def test_resolved_link_attributes_to_the_linked_user_not_a_service_identity():
    """The turn opened with this user_id must be attributed to the person
    who linked, never to a system/service account — resolve_link's user_id is
    exactly what a caller would pass as the invoking credential."""
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id, connection_id, user_id = uuid4(), uuid4(), uuid4()
    assert user_id != SERVICE_IDENTITY

    await service.create_link(
        project_id=project_id,
        user_id=user_id,
        connection_id=connection_id,
        external_user_key="U012ABC",
    )

    resolved = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="U012ABC",
    )

    assert resolved.user_id == user_id
    assert resolved.user_id != SERVICE_IDENTITY


@pytest.mark.asyncio
async def test_two_connections_same_raw_user_id_do_not_collide():
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id = uuid4()
    connection_a, connection_b = uuid4(), uuid4()
    user_a, user_b = uuid4(), uuid4()

    await service.create_link(
        project_id=project_id,
        user_id=user_a,
        connection_id=connection_a,
        external_user_key="workspace-alpha:U012ABC",
    )
    await service.create_link(
        project_id=project_id,
        user_id=user_b,
        connection_id=connection_b,
        external_user_key="workspace-beta:U012ABC",
    )

    link_a = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_a,
        external_user_key="workspace-alpha:U012ABC",
    )
    link_b = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_b,
        external_user_key="workspace-beta:U012ABC",
    )

    assert link_a.user_id == user_a
    assert link_b.user_id == user_b
    assert link_a.id != link_b.id


@pytest.mark.asyncio
async def test_rebind_preserves_row_identity_and_user_id_when_unstable():
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id, connection_id, user_id = uuid4(), uuid4(), uuid4()
    capabilities = _capabilities(stable=False)

    created = await service.create_link(
        project_id=project_id,
        user_id=user_id,
        connection_id=connection_id,
        external_user_key="old-id",
    )

    rebound = await service.rebind_link(
        project_id=project_id,
        connection_id=connection_id,
        old_external_user_key="old-id",
        new_external_user_key="new-id",
        capabilities=capabilities,
    )

    assert rebound is not None
    assert rebound.id == created.id
    assert rebound.user_id == user_id
    assert rebound.external_user_key == "new-id"

    stale = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="old-id",
    )
    fresh = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="new-id",
    )

    assert stale is None
    assert fresh is not None
    assert fresh.id == created.id


@pytest.mark.asyncio
async def test_rebind_is_unreachable_when_identity_is_stable():
    service = ChannelIdentityService(identity_dao=FakeChannelIdentityDAO())
    project_id, connection_id, user_id = uuid4(), uuid4(), uuid4()
    capabilities = _capabilities(stable=True)

    await service.create_link(
        project_id=project_id,
        user_id=user_id,
        connection_id=connection_id,
        external_user_key="stable-id",
    )

    result = await service.rebind_link(
        project_id=project_id,
        connection_id=connection_id,
        old_external_user_key="stable-id",
        new_external_user_key="anything-else",
        capabilities=capabilities,
    )

    assert result is None

    unchanged = await service.resolve_link(
        project_id=project_id,
        connection_id=connection_id,
        external_user_key="stable-id",
    )
    assert unchanged is not None
