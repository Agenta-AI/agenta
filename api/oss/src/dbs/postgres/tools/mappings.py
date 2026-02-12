from uuid import UUID

from oss.src.core.tools.dtos import Connection, ConnectionCreate
from oss.src.dbs.postgres.tools.dbes import ConnectionDBE


def map_connection_create_to_dbe(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    provider_key: str,
    integration_key: str,
    #
    dto: ConnectionCreate,
    #
    provider_connection_id: str | None = None,
    auth_config_id: str | None = None,
) -> ConnectionDBE:
    return ConnectionDBE(
        project_id=project_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        #
        provider_key=provider_key,
        integration_key=integration_key,
        #
        provider_connection_id=provider_connection_id,
        auth_config_id=auth_config_id,
        #
        is_active=True,
        is_valid=False,
        #
        created_by_id=user_id,
    )


def map_connection_dbe_to_dto(
    *,
    dbe: ConnectionDBE,
) -> Connection:
    return Connection(
        id=dbe.id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        #
        provider_key=dbe.provider_key,
        integration_key=dbe.integration_key,
        #
        provider_connection_id=dbe.provider_connection_id,
        auth_config_id=dbe.auth_config_id,
        #
        is_active=dbe.is_active,
        is_valid=dbe.is_valid,
        status=dbe.status,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        created_by_id=dbe.created_by_id,
    )
