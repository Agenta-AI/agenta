from uuid import UUID

from oss.src.core.channels.identity import (
    ChannelIdentityLink,
    ChannelIdentityLinkCreate,
)
from oss.src.dbs.postgres.channels.identity_dbes import ChannelIdentityLinkDBE


def map_identity_link_dto_to_dbe_create(
    *,
    project_id: UUID,
    #
    link: ChannelIdentityLinkCreate,
) -> ChannelIdentityLinkDBE:
    return ChannelIdentityLinkDBE(
        project_id=project_id,
        #
        connection_id=link.connection_id,
        user_id=link.user_id,
        external_user_key=link.external_user_key,
    )


def map_identity_link_dbe_to_dto(
    *, link_dbe: ChannelIdentityLinkDBE
) -> ChannelIdentityLink:
    return ChannelIdentityLink(
        id=link_dbe.id,
        #
        created_at=link_dbe.created_at,
        updated_at=link_dbe.updated_at,
        deleted_at=link_dbe.deleted_at,
        created_by_id=link_dbe.created_by_id,
        updated_by_id=link_dbe.updated_by_id,
        deleted_by_id=link_dbe.deleted_by_id,
        #
        project_id=link_dbe.project_id,
        connection_id=link_dbe.connection_id,
        user_id=link_dbe.user_id,
        external_user_key=link_dbe.external_user_key,
    )
