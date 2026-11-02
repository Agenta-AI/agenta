from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionStatus,
)
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE


def map_connection_create_to_dbe(
    *,
    project_id: Optional[UUID],
    user_id: UUID,
    #
    dto: ConnectionCreate,
    owner: Optional[SecretOwner] = None,
    is_default: bool = False,
) -> ConnectionDBE:
    """`owner` set: a person's own row, with no project."""
    if owner is not None and owner.kind != SecretOwnerKind.USER:
        raise ValueError("a connection owner is a person")
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
        project_id=None if owner is not None else project_id,
        organization_id=owner.organization_id if owner is not None else None,
        user_id=owner.id if owner is not None else None,
        is_default=is_default,
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
        organization_id=dbe.organization_id,
        user_id=dbe.user_id,
        is_default=bool(dbe.is_default),
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
    )
