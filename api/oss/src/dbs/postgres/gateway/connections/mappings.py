from uuid import UUID

from pydantic import BaseModel

from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionStatus,
)
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE


def map_connection_create_to_dbe(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    dto: ConnectionCreate,
) -> ConnectionDBE:
    # The service replaces data with a provider-shaped dict before persistence;
    # a typed model (validate-on-assignment is off) is dumped, dropping unset keys.
    data = None
    if dto.data:
        if isinstance(dto.data, BaseModel):
            data = dto.data.model_dump(exclude_none=True)
        else:
            data = dto.data

    # Merge provided flags with defaults
    flags = dto.flags or {}
    flags.setdefault("is_active", True)
    flags.setdefault("is_valid", False)

    return ConnectionDBE(
        project_id=project_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        #
        provider_key=dto.provider_key,
        integration_key=dto.integration_key,
        #
        tags=dto.tags,
        flags=flags,
        data=data,
        meta=dto.meta,
        #
        created_by_id=user_id,
    )


def map_connection_dbe_to_dto(
    *,
    dbe: ConnectionDBE,
) -> Connection:
    # Keep provider data generic in core DTOs.
    data = dbe.data or None

    # Parse status
    status = None
    if dbe.status:
        status = ConnectionStatus(**dbe.status)

    return Connection(
        id=dbe.id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        #
        provider_key=dbe.provider_key,
        integration_key=dbe.integration_key,
        #
        tags=dbe.tags,
        flags=dbe.flags,
        data=data,
        status=status,
        meta=dbe.meta,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
    )
